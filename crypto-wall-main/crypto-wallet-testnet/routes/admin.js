const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Stake = require('../models/Stake');
const Settings = require('../models/Settings');
const Referral = require('../models/Referral');
const Order = require('../models/Order');
const Position = require('../models/Position');
const SupportTicket = require('../models/SupportTicket');
const Swap = require('../models/Swap');
const Address = require('../models/Address');
const Notification = require('../models/Notification');
const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const PortfolioSnapshot = require('../models/PortfolioSnapshot');
const LeaderboardSnapshot = require('../models/LeaderboardSnapshot');
const { auth, adminOnly } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();
router.use(auth, adminOnly);

const safeUserFields = 'username email role displayName country kycStatus kycDocuments kycSelfie balances locked isBanned createdAt lastLogin';
const ADMIN_ASSETS = ['USDT','BTC','ETH','SOL','BNB','XRP','ADA','DOGE','LTC','TRX','DOT','AVAX','LINK','BCH','TON','NEAR','ATOM','UNI'];
const pageArgs = req => ({ page: Math.max(1, parseInt(req.query.page, 10) || 1), limit: Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20)) });

router.get('/stats', async (req, res) => {
  try {
    const [users, pending, completed, activeStakes, pendingKyc, stakedAgg, maintenance, openPositions, openTickets] = await Promise.all([
      User.countDocuments(), Transaction.countDocuments({ status: 'pending' }), Transaction.countDocuments({ status: 'completed' }),
      Stake.countDocuments({ status: 'active' }), User.countDocuments({ kycStatus: 'pending' }),
      Stake.aggregate([{ $match: { status: 'active' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Settings.findOne({ key: 'maintenance' }).lean(), Position.countDocuments({ amount: { $gt: 0 } }), SupportTicket.countDocuments({ status: { $ne: 'closed' } })
    ]);
    res.json({ users, pending, completed, activeStakes, pendingKyc, totalStaked: stakedAgg[0]?.total || 0, maintenance: !!maintenance?.value?.active, openPositions, openTickets });
  } catch (e) { res.status(500).json({ error: 'Could not load admin statistics' }); }
});

// Paginated collections; explicit projections prevent 2FA/password/recovery data leaking to the browser.
router.get('/users/page', async (req, res) => {
  try {
    const { page, limit } = pageArgs(req); const filter = {};
    if (req.query.search) { const q = String(req.query.search).slice(0, 100); filter.$or = [{ username: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }]; }
    const [items, total] = await Promise.all([User.find(filter).select(safeUserFields).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: 'Could not load users' }); }
});
router.get('/users', async (req, res) => {
  try { res.json(await User.find().select(safeUserFields).sort({ createdAt: -1 }).limit(500).lean()); }
  catch (e) { res.status(500).json({ error: 'Could not load users' }); }
});

// View and update a user's on-chain deposit wallet address for a supported network.
router.get('/users/:id/wallet-addresses', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('username email depositAddresses depositAddressIndex').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ userId: String(user._id), username: user.username, email: user.email, depositAddresses: user.depositAddresses || {} });
  } catch (e) { res.status(400).json({ error: 'Could not load user wallet addresses' }); }
});
router.patch('/users/:id/wallet-addresses', async (req, res) => {
  const allowed = ['TRC20','ERC20','BEP20'];
  const changes = req.body.addresses && typeof req.body.addresses === 'object'
    ? req.body.addresses
    : { [String(req.body.network || '').toUpperCase()]: req.body.address };
  const entries = Object.entries(changes).map(([network, value]) => [network.toUpperCase(), String(value ?? '').trim()]);
  if (!entries.length || entries.some(([network, address]) => !allowed.includes(network) || !address || address.length > 120))
    return res.status(400).json({ error: 'Provide a non-empty valid address for each changed network' });
  for (const [network, address] of entries) {
    if (!address) continue;
    const valid = network === 'TRC20' ? /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) : /^0x[a-fA-F0-9]{40}$/.test(address);
    if (!valid) return res.status(400).json({ error: `Invalid ${network} address format` });
  }
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const changed = [];
    for (const [network, address] of entries) {
      const previousAddress = String(user.depositAddresses?.[network] || '');
      if (previousAddress !== address) {
        user.set(`depositAddresses.${network}`, address);
        changed.push({ network, address, previousAddress });
      }
    }
    if (!changed.length) return res.json({ ok: true, changed: [] });
    await user.save();
    const { addAddressesToWebhook } = require('../utils/alchemyWebhook');
    for (const item of changed) {
      if (item.address && ['ERC20','BEP20'].includes(item.network))
        addAddressesToWebhook(item.network, [item.address.toLowerCase()]).catch(() => {});
    }
    await notify(user._id, 'system', 'Wallet deposit address updated', `Your deposit address has been updated. Please verify the network and address shown in your wallet before sending funds.`).catch(() => {});
    res.json({ ok: true, changed });
  } catch (e) { res.status(500).json({ error: 'Could not update wallet addresses' }); }
});

router.post('/users/:id/ban', async (req, res) => {
  try {
    const user = await User.findById(req.params.id); if (!user) return res.status(404).json({ error: 'User not found' });
    user.isBanned = !user.isBanned; user.tokenVersion = (user.tokenVersion || 0) + 1; await user.save();
    res.json({ isBanned: user.isBanned });
  } catch (e) { res.status(500).json({ error: 'Could not update account status' }); }
});
router.post('/users/:id/balance', async (req, res) => {
  const currency = String(req.body.currency || 'USDT').toUpperCase(); const amount = Number(req.body.amount); const reason = String(req.body.reason || '').trim();
  if (!ADMIN_ASSETS.includes(currency) || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000000 || reason.length < 5) return res.status(400).json({ error: 'Provide a supported currency, non-zero valid amount and reason (at least 5 characters)' });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const user = await User.findById(req.params.id).session(session); if (!user) throw new Error('User not found');
      const current = Number(user.balances?.[currency] || 0); if (current + amount < -1e-8) throw new Error('Adjustment would make balance negative');
      user.set(`balances.${currency}`, Number((current + amount).toFixed(12))); await user.save({ session });
      await Transaction.create([{ user: user._id, type: 'earn', category: 'admin_adjustment', direction: amount > 0 ? 'credit' : 'debit', currency, amount: Math.abs(amount), status: 'completed', note: `Balance adjustment: ${reason}`, performedBy: req.user._id }], { session });
      result = { username: user.username, balance: user.balances.get ? user.balances.get(currency) : user.balances[currency] };
    });
    await notify(req.params.id, 'system', 'Balance updated', `${amount > 0 ? '+' : ''}${amount} ${currency}: ${reason}`).catch(() => {});
    res.json(result);
  } catch (e) { res.status(e.message === 'User not found' ? 404 : 400).json({ error: e.message }); }
  finally { await session.endSession(); }
});
router.post('/users/:id/kyc', async (req, res) => {
  try {
    const { status } = req.body; if (!['unverified','pending','verified'].includes(status)) return res.status(400).json({ error: 'Invalid KYC status' });
    const user = await User.findByIdAndUpdate(req.params.id, { kycStatus: status }, { new: true }).select(safeUserFields);
    if (!user) return res.status(404).json({ error: 'User not found' });
    await notify(user._id, 'kyc', `KYC ${status}`, status === 'verified' ? 'Your identity has been verified.' : status === 'pending' ? 'Your documents are under review.' : 'Your verification was rejected.').catch(() => {});
    res.json(user);
  } catch (e) { res.status(500).json({ error: 'Could not update KYC status' }); }
});

router.get('/transactions/page', async (req, res) => {
  try {
    const { page, limit } = pageArgs(req); const filter = {};
    if (['pending','completed','rejected'].includes(req.query.status)) filter.status = req.query.status;
    const [items, total] = await Promise.all([Transaction.find(filter).populate('user', 'username email').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Transaction.countDocuments(filter)]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: 'Could not load transactions' }); }
});
router.get('/transactions', async (req, res) => {
  try { res.json(await Transaction.find().populate('user', 'username email').sort({ createdAt: -1 }).limit(500).lean()); }
  catch (e) { res.status(500).json({ error: 'Could not load transactions' }); }
});

// Atomic approval/rejection: status transition and balance mutation commit or roll back together.
router.post('/transactions/:id/:action', async (req, res) => {
  const { id, action } = req.params; const session = await mongoose.startSession(); let result; let notice;
  if (!['approve','reject'].includes(action)) { await session.endSession(); return res.status(400).json({ error: 'Invalid action' }); }
  try {
    await session.withTransaction(async () => {
      const tx = await Transaction.findOne({ _id: id, status: 'pending' }).session(session);
      if (!tx) throw new Error('Transaction not found or already processed');
      const user = await User.findById(tx.user).session(session); if (!user) throw new Error('User not found');
      if (action === 'approve') {
        if (tx.type === 'deposit') {
          const received = Number(req.body.amount);
          if (!Number.isFinite(received) || received <= 0 || received > 100000000) throw new Error('Enter a valid amount received');
          tx.amount = received; user.set(`balances.${tx.currency}`, Number(user.balances?.[tx.currency] || 0) + received);
          if (user.referredBy) {
            const ref = await Referral.findOne({ referee: user._id, bonusPaid: false }).session(session);
            if (ref) {
              const referrer = await User.findById(user.referredBy).session(session);
              if (referrer && Number(ref.bonus) > 0) {
                referrer.set('balances.USDT', Number(referrer.balances?.USDT || 0) + Number(ref.bonus));
                await referrer.save({ session }); ref.bonusPaid = true; await ref.save({ session });
              }
            }
          }
          notice = ['deposit', 'Deposit confirmed', `${received} ${tx.currency} has been credited to your wallet.`];
        } else if (tx.type === 'withdraw') {
          const locked = Number(user.locked?.[tx.currency] || 0);
          if (locked + 1e-8 < tx.amount) throw new Error('Locked balance is inconsistent; approval stopped');
          user.set(`locked.${tx.currency}`, Number((locked - tx.amount).toFixed(12)));
          notice = ['withdraw', 'Withdrawal approved', `${tx.amount} ${tx.currency} withdrawal approved for processing.`];
        }
        tx.status = 'completed';
      } else {
        if (tx.type === 'withdraw') {
          const locked = Number(user.locked?.[tx.currency] || 0);
          if (locked + 1e-8 < tx.amount) throw new Error('Locked balance is inconsistent; rejection stopped');
          user.set(`locked.${tx.currency}`, Number((locked - tx.amount).toFixed(12)));
          user.set(`balances.${tx.currency}`, Number(user.balances?.[tx.currency] || 0) + tx.amount);
        }
        tx.status = 'rejected'; if (req.body.note) tx.note = `${tx.note ? tx.note + ' · ' : ''}${String(req.body.note).slice(0, 500)}`;
        notice = [tx.type, `${tx.type[0].toUpperCase()}${tx.type.slice(1)} rejected`, String(req.body.note || 'Please contact support for details.')];
      }
      tx.updatedAt = new Date(); await user.save({ session }); await tx.save({ session }); result = tx.toObject();
    });
    if (notice) await notify(result.user, notice[0], notice[1], notice[2]).catch(() => {});
    res.json(result);
  } catch (e) { res.status(/not found|already processed/i.test(e.message) ? 409 : 400).json({ error: e.message }); }
  finally { await session.endSession(); }
});

router.get('/stakes', async (req, res) => { try { res.json(await Stake.find().populate('user', 'username email').sort({ startedAt: -1 }).limit(500).lean()); } catch (e) { res.status(500).json({ error: 'Could not load stakes' }); } });
router.post('/banner', async (req, res) => { const s = await Settings.findOneAndUpdate({ key: 'banner' }, { value: { message: String(req.body.message || '').slice(0, 500), active: !!req.body.active } }, { upsert: true, new: true }); res.json(s); });
router.post('/maintenance', async (req, res) => { const s = await Settings.findOneAndUpdate({ key: 'maintenance' }, { value: { active: !!req.body.active, message: String(req.body.message || 'We are upgrading. Please check back shortly.').slice(0, 500) } }, { upsert: true, new: true }); res.json(s); });

// Support desk
router.get('/support', async (req, res) => {
  try { const { page, limit } = pageArgs(req); const filter = {}; if (req.query.status && ['open','in_progress','waiting_user','closed'].includes(req.query.status)) filter.status = req.query.status;
    const [items, total] = await Promise.all([SupportTicket.find(filter).populate('user','username email').sort({ updatedAt: -1 }).skip((page-1)*limit).limit(limit).lean(), SupportTicket.countDocuments(filter)]);
    res.json({ items, page, limit, total, pages: Math.ceil(total/limit) });
  } catch (e) { res.status(500).json({ error: 'Could not load support tickets' }); }
});
router.post('/support/:id/reply', async (req, res) => {
  try { const body = String(req.body.message || '').trim(); if (body.length < 2 || body.length > 5000) return res.status(400).json({ error: 'Reply must be 2–5000 characters' });
    const ticket = await SupportTicket.findById(req.params.id); if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    ticket.messages.push({ sender: 'admin', body }); ticket.status = 'waiting_user'; ticket.updatedAt = new Date(); await ticket.save();
    await notify(ticket.user, 'system', `Support replied: ${ticket.subject}`, body.slice(0, 180)).catch(() => {}); res.json(ticket);
  } catch (e) { res.status(500).json({ error: 'Could not reply to ticket' }); }
});
router.patch('/support/:id', async (req, res) => {
  try { const update = {}; if (['open','in_progress','waiting_user','closed'].includes(req.body.status)) update.status = req.body.status; if (['low','normal','high','urgent'].includes(req.body.priority)) update.priority = req.body.priority;
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { $set: { ...update, updatedAt: new Date() } }, { new: true }); if (!ticket) return res.status(404).json({ error: 'Ticket not found' }); res.json(ticket);
  } catch (e) { res.status(500).json({ error: 'Could not update ticket' }); }
});

// Platform/trading controls. One admin role remains the only privileged role.
router.get('/controls', async (req, res) => {
  const [trading, pairs] = await Promise.all([Settings.findOne({ key: 'trading' }).lean(), Settings.findOne({ key: 'tradingPairs' }).lean()]);
  res.json({ trading: trading?.value || { enabled: true, message: '' }, pairs: pairs?.value || {} });
});
router.post('/controls/trading', async (req, res) => {
  const value = { enabled: !!req.body.enabled, message: String(req.body.message || '').slice(0, 300) };
  const s = await Settings.findOneAndUpdate({ key: 'trading' }, { value }, { upsert: true, new: true }); res.json(s.value);
});
router.post('/controls/pair', async (req, res) => {
  const pair = String(req.body.pair || '').toUpperCase(); if (!/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/.test(pair)) return res.status(400).json({ error: 'Invalid pair' });
  const doc = await Settings.findOne({ key: 'tradingPairs' }) || new Settings({ key: 'tradingPairs', value: {} });
  const value = { ...(doc.value || {}), [pair]: { enabled: !!req.body.enabled, updatedAt: new Date() } }; doc.value = value; await doc.save(); res.json({ pair, enabled: value[pair].enabled });
});
router.get('/positions', async (req, res) => {
  try { const { page, limit } = pageArgs(req); const filter = { amount: { $gt: 0 } }; const [items,total] = await Promise.all([Position.find(filter).populate('user','username email').sort({ updatedAt: -1 }).skip((page-1)*limit).limit(limit).lean(), Position.countDocuments(filter)]); res.json({ items, page, limit, total, pages: Math.ceil(total/limit) }); }
  catch (e) { res.status(500).json({ error: 'Could not load open positions' }); }
});
router.patch('/positions/:id', async (req, res) => {
  try {
    const set = {};
    for (const key of ['avgCost', 'stopLoss', 'takeProfit']) {
      if (req.body[key] === undefined) continue;
      const n = Number(req.body[key]);
      if (!Number.isFinite(n) || n < 0 || (key === 'avgCost' && n <= 0)) {
        return res.status(400).json({ error: `Invalid ${key}` });
      }
      set[key] = n;
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'No position changes supplied' });
    const current = await Position.findOne({ _id: req.params.id, amount: { $gt: 0 } });
    if (!current) return res.status(404).json({ error: 'Open position not found' });
    const entry = set.avgCost ?? current.avgCost;
    const sl = set.stopLoss ?? current.stopLoss;
    const tp = set.takeProfit ?? current.takeProfit;
    if (sl > 0 && sl >= entry) return res.status(400).json({ error: 'Stop loss must be below the entry price' });
    if (tp > 0 && tp <= entry) return res.status(400).json({ error: 'Take profit must be above the entry price' });
    const pos = await Position.findOneAndUpdate(
      { _id: req.params.id, amount: { $gt: 0 } },
      { $set: { ...set, updatedAt: new Date() } },
      { new: true, runValidators: true }
    );
    if (!pos) return res.status(409).json({ error: 'Position was closed before the changes could be saved' });
    res.json({ position: pos, note: set.avgCost !== undefined ? 'Entry price updated; wallet balances and original trade records were not changed.' : undefined });
  } catch (e) { res.status(500).json({ error: 'Could not update position' }); }
});
router.post('/positions/:id/close', async (req, res) => {
  try {
    const closePrice = Number(req.body.closePrice);
    if (!Number.isFinite(closePrice) || closePrice <= 0 || closePrice > 1e15) {
      return res.status(400).json({ error: 'Enter a valid positive close price' });
    }
    const pos = await Position.findOne({ _id: req.params.id, amount: { $gt: 0 } });
    if (!pos) return res.status(404).json({ error: 'Open position not found' });
    const orderRoutes = require('./orders');
    const result = await orderRoutes.closePositionAtomic(pos._id, pos.user, closePrice, 'Manual', req.user._id);
    if (!result) return res.status(409).json({ error: 'Position already closed' });
    await notify(pos.user, 'system', 'Position closed', `Your ${pos.pair} position was closed at ${closePrice}. Realized PnL: ${result.pnl} ${result.quote}`).catch(() => {});
    res.json({ closed: true, closePrice, ...result });
  } catch (e) { res.status(500).json({ error: e.message || 'Could not close position' }); }
});

// Database diagnostics and logical export. No destructive database commands are exposed.
router.get('/database/health', async (req, res) => {
  try { const admin = mongoose.connection.db.admin(); const [ping, collections] = await Promise.all([admin.ping(), mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()]);
    const names = collections.map(c => c.name); const counts = await Promise.all(names.map(async name => ({ name, count: await mongoose.connection.db.collection(name).countDocuments() })));
    res.json({ state: mongoose.connection.readyState, host: mongoose.connection.host, name: mongoose.connection.name, ping: !!ping.ok, collections: counts, serverVersion: (await admin.serverInfo()).version });
  } catch (e) { res.status(500).json({ error: 'Database diagnostics failed' }); }
});
router.get('/database/export', async (req, res) => {
  try { const [users, transactions, orders, positions, tickets, stakes, swaps, addresses, notifications, copyTraders, copyRelations, portfolioSnapshots, leaderboardSnapshots] = await Promise.all([
    User.find().select('-password -twoFASecret -twoFAPendingSecret -twoFARecoveryCodes -securityQuestions.answerHash -resetToken').lean(),
    Transaction.find().lean(), Order.find().lean(), Position.find().lean(), SupportTicket.find().lean(), Stake.find().lean(), Swap.find().lean(), Address.find().lean(),
    Notification.find().lean(), CopyTrader.find().lean(), CopyRelation.find().lean(), PortfolioSnapshot.find().lean(), LeaderboardSnapshot.find().lean()
  ]); res.setHeader('Content-Type','application/json'); res.setHeader('Content-Disposition', `attachment; filename=novawallet-export-${new Date().toISOString().slice(0,10)}.json`); res.json({ exportedAt: new Date(), users, transactions, orders, positions, tickets, stakes, swaps, addresses, notifications, copyTraders, copyRelations, portfolioSnapshots, leaderboardSnapshots });
  } catch (e) { res.status(500).json({ error: 'Database export failed' }); }
});
module.exports = router;
