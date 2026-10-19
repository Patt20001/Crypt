const express = require('express');
const Stake = require('../models/Stake');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

const PLANS = {
  flexible: { apy: 4.5,  days: 0,   label: 'Flexible' },
  '30d':    { apy: 7.2,  days: 30,  label: '30 Days' },
  '90d':    { apy: 10.5, days: 90,  label: '90 Days' },
  '180d':   { apy: 14.8, days: 180, label: '180 Days' }
};

// Accrue yield up to now (compound-free simple interest)
function accrue(stake) {
  const now = Date.now();
  const last = new Date(stake.lastAccrualAt).getTime();
  const days = (now - last) / (1000 * 60 * 60 * 24);
  const dailyRate = stake.apy / 100 / 365;
  stake.accrued += stake.amount * dailyRate * days;
  stake.lastAccrualAt = new Date(now);
}

router.get('/plans', (req, res) => {
  res.json(Object.entries(PLANS).map(([id, p]) => ({ id, ...p })));
});

router.get('/my-stakes', auth, async (req, res) => {
  const stakes = await Stake.find({ user: req.user._id }).sort({ startedAt: -1 });
  stakes.forEach(s => { if (s.status === 'active') accrue(s); });
  await Promise.all(stakes.map(s => s.save()));
  res.json(stakes);
});

router.post('/stake', auth, async (req, res) => {
  try {
    const { plan, amount } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const user = await User.findById(req.user._id);
    if (user.balances.USDT < amount)
      return res.status(400).json({ error: 'Insufficient USDT balance' });

    const p = PLANS[plan];
    const maturesAt = new Date(Date.now() + p.days * 24 * 60 * 60 * 1000);

    user.balances.USDT -= amount;
    await user.save();

    const stake = await Stake.create({
      user: user._id, plan, amount, apy: p.apy, maturesAt
    });

    await Transaction.create({
      user: user._id, type: 'earn', currency: 'USDT',
      amount: -amount, status: 'completed',
      note: `Staked in ${p.label} plan @ ${p.apy}% APY`
    });

    res.json(stake);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/unstake/:id', auth, async (req, res) => {
  try {
    const stake = await Stake.findOne({ _id: req.params.id, user: req.user._id });
    if (!stake || stake.status !== 'active')
      return res.status(400).json({ error: 'Stake not active' });

    accrue(stake);
    const early = Date.now() < new Date(stake.maturesAt).getTime() && stake.plan !== 'flexible';
    const penaltyRate = early ? 0.05 : 0;
    const gross = stake.amount + stake.accrued;
    const penalty = gross * penaltyRate;
    const payout = gross - penalty;

    const user = await User.findById(req.user._id);
    user.balances.USDT += payout;
    await user.save();

    stake.status = 'closed';
    stake.closedAt = new Date();
    await stake.save();

    await Transaction.create({
      user: user._id, type: 'earn', currency: 'USDT',
      amount: payout, status: 'completed',
      note: early
        ? `Early unstake (5% penalty). Principal + ${stake.accrued.toFixed(4)} USDT yield`
        : `Unstaked principal + ${stake.accrued.toFixed(4)} USDT yield`
    });

    res.json({ payout, penalty, stake });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;