const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const { round, getPlatformRate, calcFees, recordFees } = require('../utils/copyFees');
const router = express.Router();


class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function withTxn(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => { out = await fn(session); });
    return out;
  } finally { await session.endSession(); }
}

function sendError(res, e, fallback) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
  if (e.name === 'CastError') return res.status(404).json({ error: 'Not found' });
  if (e.code === 11000) return res.status(400).json({ error: 'Already following' });
  console.error('copy route error:', e.message);
  return res.status(500).json({ error: fallback });
}

/* Risk score (1–10) from volatility and drawdown of the ROI history plus win rate. */
function computeRisk(t) {
  const h = (t.performanceHistory || []).map(p => Number(p.roi30d)).filter(Number.isFinite);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const win = Number(t.winRate || 0);
  const winPts = win >= 65 ? 0 : win >= 55 ? 1 : win >= 45 ? 1.5 : 2;
  let total;
  if (h.length >= 10) {
    const d = []; for (let i = 1; i < h.length; i++) d.push(h[i] - h[i - 1]);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const vol = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    let peak = h[0], dd = 0;
    for (const v of h) { peak = Math.max(peak, v); dd = Math.max(dd, peak - v); }
    total = clamp(vol / 2 * 4, 0, 4) + clamp(dd / 30 * 4, 0, 4) + winPts;
  } else {
    const roi = Number(t.roi30d || 0);
    total = 2 + winPts + (roi < 0 ? 2 : 0) + (Math.abs(roi) > 50 ? 2 : 0);
  }
  const score = clamp(Math.round(1 + total * 0.9), 1, 10);
  return { riskScore: score, riskLevel: score <= 3 ? 'Low' : score <= 6 ? 'Medium' : 'High' };
}

/* Stops an active copy: settles any unpaid performance fee, returns allocation + PnL (less fees)
   to the follower's wallet. Atomic, and a copy can only ever be stopped once. */
async function stopCopy(relationId, followerId) {
  return withTxn(async session => {
    const filter = { _id: relationId, active: true };
    if (followerId) filter.follower = followerId;
    const rel = await CopyRelation.findOne(filter).session(session);
    if (!rel) throw new HttpError(404, 'This copy was not found or has already been stopped');
    const trader = await CopyTrader.findById(rel.trader).session(session);
    const fees = trader ? calcFees(rel, trader, await getPlatformRate(trader, session)) : { newProfit: 0, traderFee: 0, platformFee: 0, total: 0 };
    const payout = Math.max(0, round(Number(rel.allocation || 0) + Number(rel.pnl || 0) - fees.total));

    await CopyRelation.updateOne({ _id: rel._id }, { $set: { active: false } }, { session });
    if (trader && fees.total > 0) await recordFees({ session, rel, trader, fees });

    const user = await User.findById(rel.follower).session(session);
    if (!user) throw new HttpError(404, 'User not found');
    user.set('locked.USDT', Math.max(0, round(Number(user.locked?.USDT || 0) - Number(rel.allocation || 0))));
    user.set('balances.USDT', round(Number(user.balances?.USDT || 0) + payout));
    await user.save({ session });

    if (trader) await CopyTrader.updateOne({ _id: trader._id, followers: { $gt: 0 } }, { $inc: { followers: -1 } }, { session });
    return { userId: rel.follower, payout, fees, traderName: trader?.displayName || 'trader' };
  });
}

async function notifyStopped(r) {
  const feeNote = r.fees.total > 0 ? ` after ${r.fees.total.toFixed(2)} USDT in fees` : '';
  await notify(r.userId, 'system', 'Copy trading stopped',
    `${r.payout.toFixed(2)} USDT returned to your wallet${feeNote}`).catch(() => {});
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/* GET all copy traders */
router.get('/', auth, async (req, res) => {
  const traders = await CopyTrader.find({ active: true }).select('-performanceHistory').sort({ featured: -1, roi30d: -1 }).lean();
  res.json(traders);
});

/* GET my copy relations */
router.get('/my', auth, async (req, res) => {
  const relations = await CopyRelation.find({ follower: req.user._id, active: true })
    .populate('trader', 'displayName bio tier roi30d winRate followers totalTrades performanceFee platformFee featured');
  res.json(relations);
});

/* Platform fee shown to followers before they start copying. */
router.get('/fees', auth, async (req, res) => {
  try {
    const setting = await Settings.findOne({ key: 'copyPlatformFeePercent' }).lean();
    res.json({ platformFeePercent: setting && Number.isFinite(Number(setting.value)) ? Number(setting.value) : null });
  } catch (e) { res.status(500).json({ error: 'Could not load fees' }); }
});

/* Trader profile with risk score. */
router.get('/:id/profile', auth, async (req, res) => {
  try {
    const trader = await CopyTrader.findOne({ _id: req.params.id, active: true })
      .select('displayName bio tier roi30d winRate followers totalTrades performanceFee platformFee featured totalEarned performanceHistory').lean();
    if (!trader) return res.status(404).json({ error: 'Trader not found' });
    const risk = computeRisk(trader);
    delete trader.performanceHistory;
    res.json({ ...trader, ...risk });
  } catch (e) { res.status(400).json({ error: 'Invalid trader' }); }
});

router.get('/:id/history', auth, async (req, res) => {
  try {
    const days = [30, 90, 180].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const trader = await CopyTrader.findOne({ _id: req.params.id, active: true }).select('performanceHistory roi30d');
    if (!trader) return res.status(404).json({ error: 'Trader not found' });
    const since = new Date(); since.setDate(since.getDate() - days + 1);
    let points = (trader.performanceHistory || []).filter(p => new Date(p.date) >= since).map(p => ({ date: p.date, roi: p.roi30d }));
    if (!points.length) points = [{ date: new Date(), roi: trader.roi30d }];
    res.json({ days, points });
  } catch (e) { res.status(400).json({ error: 'Could not load trader history' }); }
});

/* POST follow a trader — balance check, debit and relation are one atomic transaction */
router.post('/follow/:traderId', auth, async (req, res) => {
  try {
    const amt = round(req.body.allocation);
    if (!Number.isFinite(amt) || amt < 10) return res.status(400).json({ error: 'Minimum allocation is 10 USDT' });
    if (amt > 1e9) return res.status(400).json({ error: 'Invalid allocation' });

    const { relation, trader } = await withTxn(async session => {
      const trader = await CopyTrader.findOne({ _id: req.params.traderId, active: true }).session(session);
      if (!trader) throw new HttpError(404, 'Trader not found');

      const existing = await CopyRelation.findOne({ follower: req.user._id, trader: trader._id }).session(session);
      if (existing && existing.active) throw new HttpError(400, 'Already following');

      const debit = await User.updateOne(
        { _id: req.user._id, 'balances.USDT': { $gte: amt } },
        { $inc: { 'balances.USDT': -amt, 'locked.USDT': amt } }, { session });
      if (!debit.modifiedCount) throw new HttpError(400, 'Insufficient USDT');

      let relation;
      if (existing) {
        await CopyRelation.updateOne({ _id: existing._id }, { $set: {
          allocation: amt, active: true, autoCopy: true, pnl: 0, highWaterMark: 0, lastTraderRoi: trader.roi30d
        } }, { session });
        relation = await CopyRelation.findById(existing._id).session(session);
      } else {
        [relation] = await CopyRelation.create([{
          follower: req.user._id, trader: trader._id, allocation: amt, lastTraderRoi: trader.roi30d
        }], { session });
      }
      await CopyTrader.updateOne({ _id: trader._id }, { $inc: { followers: 1 } }, { session });
      return { relation, trader };
    });

    await notify(req.user._id, 'system', 'Copy trading started',
      `You are now copying ${trader.displayName} with ${amt} USDT`).catch(() => {});
    res.json(relation);
  } catch (e) { sendError(res, e, 'Could not start copying. Please try again.'); }
});

/* POST unfollow — settles any outstanding performance fee, then returns funds exactly once */
router.post('/unfollow/:relationId', auth, async (req, res) => {
  try {
    const result = await stopCopy(req.params.relationId, req.user._id);
    await notifyStopped(result);
    res.json({ ok: true, returned: result.payout, fees: result.fees.total });
  } catch (e) { sendError(res, e, 'Could not stop copying. Please try again.'); }
});

/* POST seed traders — admin only */
router.post('/seed', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const force = req.query.force === 'true';

    if (force) {
      await CopyTrader.deleteMany({});
    } else {
      const existing = await CopyTrader.countDocuments();
      if (existing > 0) {
        return res.json({
          message: 'Already seeded',
          count: existing,
          hint: 'Use ?force=true to reset and reseed'
        });
      }
    }

    const traders = await CopyTrader.insertMany([
      { displayName: 'Alpha Whale',    bio: 'Swing trader focusing on BTC/ETH breakouts',
        tier: 'diamond', roi30d: 42.5, winRate: 71, followers: 1284, totalTrades: 892, featured: true },
      { displayName: 'DeFi Degen',     bio: 'Altcoin hunter. High risk, high reward',
        tier: 'gold',    roi30d: 28.3, winRate: 63, followers: 674, totalTrades: 1203, featured: true },
      { displayName: 'Steady Eddie',   bio: 'Conservative BTC accumulation strategy',
        tier: 'silver',  roi30d: 12.1, winRate: 78, followers: 312, totalTrades: 445 },
      { displayName: 'Momentum Mike',  bio: 'Breakout scalper on SOL/BNB',
        tier: 'gold',    roi30d: 22.8, winRate: 58, followers: 891, totalTrades: 2104 },
      { displayName: 'Patient Paul',   bio: 'Long-term holder, low frequency',
        tier: 'bronze',  roi30d: 6.4,  winRate: 82, followers: 156, totalTrades: 87 },
      { displayName: 'Scalpel Sarah',  bio: 'Intraday trader with tight stops',
        tier: 'diamond', roi30d: 38.7, winRate: 66, followers: 2103, totalTrades: 4521 }
    ]);

    res.json({ message: 'Seeded', count: traders.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST populate — generate 100+ realistic traders (admin only) */
router.post('/populate', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const count = Math.min(Number(req.query.count) || 100, 250);

    const FIRST = ['Alex','Sam','Jordan','Taylor','Morgan','Casey','Riley','Jamie','Avery','Quinn',
      'Kai','Noor','Zara','Omar','Mia','Leo','Nia','Ravi','Sara','Theo','Ivy','Ezra','Luna',
      'Priya','Diego','Anya','Kofi','Yuki','Hana','Rami','Akio','Nora','Idris','Lina','Mateo','Ade',
      'Zoe','Ivan','Fatima','Oscar','Nina','Hugo','Elif','Jonas','Amara','Kenji','Salma','Rico','Leila'];
    const LAST = ['Trader','Capital','Alpha','Delta','Prime','Edge','Quant','Rocket','Bear','Bull',
      'Scalper','Swing','Whale','Flow','Ventures','Signal','Chart','Byte','Node','Fund','Hunter',
      'Pulse','Wave','Momentum','Trend','Stack','Gain','Yield','Lever','Spot'];
    const SUFFIX = ['','_fx','Trade','_pro','X','_capital','_labs','_v2','',''];
    const BIOS = [
      'Systematic trend follower focused on BTC and ETH breakouts.',
      'Altcoin hunter with a bias toward early momentum plays.',
      'Risk-managed swing trader using volume confirmation.',
      'Intraday scalper on the SOL/BNB rotation.',
      'Long-biased accumulator with multi-month horizons.',
      'Mean-reversion trader focused on high-volatility altcoins.',
      'Breakout specialist on large-cap crypto.',
      'Quant-driven trader using momentum and volatility filters.',
      'Conservative portfolio approach with tight risk limits.',
      'Event-driven trader playing major market catalysts.',
      'Grid bot manager with automated rebalancing.',
      'Macro-aligned swing trader playing crypto cycles.',
      'Order-flow focused trader watching liquidations.',
      'Delta-neutral carry strategy with USDT lending.',
      'Momentum scalper with 1m and 5m timeframes.',
      'Range trader on sideways markets and consolidation.',
      'Volatility premium collector via options and spot.',
      'Narrative-driven trader following narrative rotation.'
    ];
    const TIERS = ['bronze','bronze','silver','silver','gold','gold','diamond'];

    function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function rndBetween(a, b, dec = 2) { return +(Math.random() * (b - a) + a).toFixed(dec); }

    const toInsert = [];
    const seen = new Set();
    let attempts = 0;

    while (toInsert.length < count && attempts < count * 10) {
      attempts++;
      const name = `${rnd(FIRST)} ${rnd(LAST)}${rnd(SUFFIX)}`;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      const tier = rnd(TIERS);
      const roi30d = tier === 'diamond' ? rndBetween(25, 65)
                   : tier === 'gold'    ? rndBetween(12, 38)
                   : tier === 'silver'  ? rndBetween(4, 18)
                   :                       rndBetween(-3, 8);
      const winRate = tier === 'diamond' ? rndBetween(64, 82, 0)
                   : tier === 'gold'    ? rndBetween(56, 74, 0)
                   : tier === 'silver'  ? rndBetween(48, 66, 0)
                   :                       rndBetween(40, 58, 0);
      const totalTrades = Math.floor(Math.random() * 4000) + 50;
      const followers = Math.floor(Math.random() * 3000 * (tier === 'diamond' ? 3 : 1));

      toInsert.push({
        displayName: name,
        bio: rnd(BIOS),
        tier,
        roi30d,
        winRate,
        totalTrades,
        followers,
        performanceFee: tier === 'diamond' ? 15 : 10,
        platformFee: 2,
        featured: tier === 'diamond' && Math.random() > 0.7,
        active: true
      });
    }

    const inserted = await CopyTrader.insertMany(toInsert, { ordered: false });

    res.json({
      message: `Generated ${inserted.length} traders`,
      count: inserted.length,
      total: await CopyTrader.countDocuments()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET all copy relations — admin only */
router.get('/admin/relations', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const relations = await CopyRelation.find()
      .populate('follower', 'username email')
      .populate('trader', 'displayName tier performanceFee platformFee roi30d winRate followers totalTrades bio')
      .sort({ createdAt: -1 });
    res.json(relations);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET copy trading stats — admin only */
router.get('/admin/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const activeRelations = await CopyRelation.countDocuments({ active: true });
    const totalAllocatedAgg = await CopyRelation.aggregate([
      { $match: { active: true } },
      { $group: { _id: null, total: { $sum: '$allocation' } } }
    ]);
    const traders = await CopyTrader.countDocuments({ active: true });
    const totalFollowersAgg = await CopyTrader.aggregate([
      { $match: { active: true } },
      { $group: { _id: null, total: { $sum: '$followers' } } }
    ]);
    res.json({
      activeRelations,
      totalAllocated: totalAllocatedAgg[0]?.total || 0,
      traders,
      totalFollowers: totalFollowersAgg[0]?.total || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET profit-sharing totals — admin only */
router.get('/admin/fees', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const totalTraderFees = await CopyRelation.aggregate([
      { $group: { _id: null, total: { $sum: '$traderFees' } } }
    ]);
    const totalPlatformFees = await CopyRelation.aggregate([
      { $group: { _id: null, total: { $sum: '$platformFees' } } }
    ]);
    const topTraders = await CopyTrader.find({ totalEarned: { $gt: 0 } })
      .sort({ totalEarned: -1 })
      .limit(10)
      .select('displayName tier totalEarned followers');

    res.json({
      totalTraderFees: totalTraderFees[0]?.total || 0,
      totalPlatformFees: totalPlatformFees[0]?.total || 0,
      topTraders
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST force-stop a copy relation — admin only (same settlement path as a user stop) */
router.post('/admin/relations/:id/stop', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const result = await stopCopy(req.params.id, null);
    await notifyStopped(result);
    res.json({ ok: true, returned: result.payout, fees: result.fees.total });
  } catch (e) { sendError(res, e, 'Could not stop this copy'); }
});

/* POST import traders from CSV — admin only */
router.post('/import', auth, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const csv = req.file.buffer.toString('utf-8');
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + data' });

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const required = ['displayname', 'bio', 'tier', 'roi30d', 'winrate'];
    for (const col of required) {
      if (!header.includes(col)) {
        return res.status(400).json({
          error: `Missing required column: ${col}. Required: ${required.join(', ')}`
        });
      }
    }

    const idx = col => header.indexOf(col);
    const validTiers = ['bronze', 'silver', 'gold', 'diamond'];

    const toInsert = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const name = cols[idx('displayname')];
      if (!name) { errors.push(`Line ${i + 1}: empty displayName`); continue; }

      const tier = cols[idx('tier')]?.toLowerCase();
      if (!validTiers.includes(tier)) {
        errors.push(`Line ${i + 1}: invalid tier "${tier}"`);
        continue;
      }

      toInsert.push({
        displayName: name,
        bio: cols[idx('bio')] || '',
        tier,
        roi30d: Number(cols[idx('roi30d')]) || 0,
        winRate: Number(cols[idx('winrate')]) || 0,
        followers: header.includes('followers') ? (Number(cols[idx('followers')]) || 0) : 0,
        totalTrades: header.includes('totaltrades') ? (Number(cols[idx('totaltrades')]) || 0) : 0,
        performanceFee: header.includes('performancefee') ? (Number(cols[idx('performancefee')]) || 10) : 10,
        platformFee: header.includes('platformfee') ? (Number(cols[idx('platformfee')]) || 2) : 2,
        active: true
      });
    }

    if (!toInsert.length) {
      return res.status(400).json({ error: 'No valid rows to import', errors });
    }

    const inserted = await CopyTrader.insertMany(toInsert, { ordered: false });

    res.json({
      message: `Imported ${inserted.length} traders`,
      count: inserted.length,
      errors,
      total: await CopyTrader.countDocuments()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* POST set profit-sharing fee for a trader — admin only */
router.post('/admin/traders/:id/fees', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { performanceFee, platformFee } = req.body;
    const perf = Number(performanceFee);
    const plat = Number(platformFee);
    if (perf < 0 || perf > 50) return res.status(400).json({ error: 'Performance fee must be 0–50%' });
    if (plat < 0 || plat > 20) return res.status(400).json({ error: 'Platform fee must be 0–20%' });

    const trader = await CopyTrader.findByIdAndUpdate(
      req.params.id,
      { performanceFee: perf, platformFee: plat },
      { new: true }
    );
    if (!trader) return res.status(404).json({ error: 'Trader not found' });
    res.json(trader);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST adjust copy relation PnL — admin only (support) */
router.post('/admin/relations/:id/adjust', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { amount, reason } = req.body;
    const amt = Number(amount);
    if (!amt) return res.status(400).json({ error: 'Amount required' });

    const rel = await CopyRelation.findById(req.params.id).populate('trader');
    if (!rel) return res.status(404).json({ error: 'Relation not found' });

        rel.pnl = (rel.pnl || 0) + amt;
    await rel.save();

    res.json({ relation: rel, adjustment: amt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;