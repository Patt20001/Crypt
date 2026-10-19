const express = require('express');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Stake = require('../models/Stake');
const Settings = require('../models/Settings');
const Referral = require('../models/Referral');
const { auth, adminOnly } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

router.use(auth, adminOnly);

/* ============ STATS ============ */
router.get('/stats', async (req, res) => {
  const [users, pending, completed, activeStakes, pendingKyc, stakedAgg, maintenance] = await Promise.all([
    User.countDocuments(),
    Transaction.countDocuments({ status: 'pending' }),
    Transaction.countDocuments({ status: 'completed' }),
    Stake.countDocuments({ status: 'active' }),
    User.countDocuments({ kycStatus: 'pending' }),
    Stake.aggregate([{ $match: { status: 'active' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Settings.findOne({ key: 'maintenance' })
  ]);
  res.json({
    users, pending, completed, activeStakes, pendingKyc,
    totalStaked: stakedAgg[0]?.total || 0,
    maintenance: !!maintenance?.value?.active
  });
});

/* ============ USERS ============ */
router.get('/users', async (req, res) => {
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  res.json(users);
});

router.post('/users/:id/ban', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.isBanned = !user.isBanned;
  user.tokenVersion = (user.tokenVersion || 0) + 1; // force logout
  await user.save();
  res.json({ isBanned: user.isBanned });
});

router.post('/users/:id/balance', async (req, res) => {
  const { currency = 'USDT', amount } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.balances[currency] = (user.balances[currency] || 0) + Number(amount);
  await user.save();
  await notify(user._id, 'system',
    'Balance updated',
    `Admin adjusted your ${currency} balance by ${amount > 0 ? '+' : ''}${amount}.`);
  res.json(user);
});

router.post('/users/:id/kyc', async (req, res) => {
  const { status } = req.body;
  if (!['unverified', 'pending', 'verified'].includes(status))
    return res.status(400).json({ error: 'Invalid KYC status' });
  const user = await User.findByIdAndUpdate(req.params.id, { kycStatus: status }, { new: true }).select('-password');
  await notify(user._id, 'kyc',
    `KYC ${status}`,
    status === 'verified' ? 'Your identity has been verified. Higher withdrawal limits are now active.'
    : status === 'pending' ? 'Your documents are under review.'
    : 'Your verification was rejected. Please resubmit valid documents.');
  res.json(user);
});

/* ============ TRANSACTIONS ============ */
router.get('/transactions', async (req, res) => {
  const txs = await Transaction.find().populate('user', 'username email').sort({ createdAt: -1 });
  res.json(txs);
});

router.post('/transactions/:id/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    const { amount, note } = req.body;

    if (!['approve', 'reject'].includes(action))
      return res.status(400).json({ error: 'Invalid action' });

    const tx = await Transaction.findById(id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const user = await User.findById(tx.user);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (action === 'approve') {
      if (tx.type === 'deposit') {
        const received = Number(amount);
        if (!received || received <= 0)
          return res.status(400).json({ error: 'Enter the amount received' });
        tx.amount = received;
        user.balances[tx.currency] += received;
        await user.save();

        // Pay referral bonus on first deposit
        if (user.referredBy) {
          const ref = await Referral.findOne({ referee: user._id });
          if (ref && !ref.bonusPaid) {
            const referrer = await User.findById(user.referredBy);
            if (referrer) {
              referrer.balances.USDT += ref.bonus;
              await referrer.save();
              ref.bonusPaid = true;
              await ref.save();
              await notify(referrer._id, 'referral',
                'Referral bonus credited',
                `+${ref.bonus} USDT for your referral ${user.username}'s first deposit.`);
            }
          }
        }

        await notify(user._id, 'deposit',
          'Deposit confirmed',
          `${received} ${tx.currency} has been credited to your wallet.`);
      }

      if (tx.type === 'withdraw') {
        // Funds are already locked; just drain locked
        user.locked[tx.currency] = Math.max(0, (user.locked[tx.currency] || 0) - tx.amount);
        await user.save();
        await notify(user._id, 'withdraw',
          'Withdrawal sent',
          `${tx.amount} ${tx.currency} sent to ${tx.address.slice(0, 10)}…`);
      }

      tx.status = 'completed';
    } else {
      // Reject: release locked funds back to balance
      if (tx.type === 'withdraw') {
        user.locked[tx.currency] = Math.max(0, (user.locked[tx.currency] || 0) - tx.amount);
        user.balances[tx.currency] += tx.amount;
        await user.save();
      }
      tx.status = 'rejected';
      if (note) tx.note = `${tx.note ? tx.note + ' · ' : ''}${note}`;
      await notify(user._id, 'withdraw',
        `${tx.type[0].toUpperCase() + tx.type.slice(1)} rejected`,
        note || 'Please contact support for details.');
    }

    tx.updatedAt = Date.now();
    await tx.save();
    res.json(tx);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============ STAKES ============ */
router.get('/stakes', async (req, res) => {
  const stakes = await Stake.find().populate('user', 'username email').sort({ startedAt: -1 });
  res.json(stakes);
});

/* ============ BANNER & MAINTENANCE ============ */
router.post('/banner', async (req, res) => {
  const { message, active } = req.body;
  const s = await Settings.findOneAndUpdate(
    { key: 'banner' },
    { value: { message: message || '', active: !!active } },
    { upsert: true, new: true }
  );
  res.json(s);
});

router.post('/maintenance', async (req, res) => {
  const { active, message } = req.body;
  const s = await Settings.findOneAndUpdate(
    { key: 'maintenance' },
    { value: { active: !!active, message: message || 'We are upgrading. Please check back shortly.' } },
    { upsert: true, new: true }
  );
  res.json(s);
});

module.exports = router;