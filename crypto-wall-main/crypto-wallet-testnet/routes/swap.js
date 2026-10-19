const express = require('express');
const Swap = require('../models/Swap');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const router = express.Router();

// Fixed rates: 1 unit of key currency -> value in USDT
// BTC and ETH priced in USDT. USDT <-> USDT not allowed.
const USD_PRICE = {
  BTC: 68000,
  ETH: 3500
};

const FEE_RATE = 0.005; // 0.5% swap fee

// Get rate quote
router.get('/quote', auth, (req, res) => {
  const { from, to, amount } = req.query;
  if (!from || !to || from === to)
    return res.status(400).json({ error: 'Invalid pair' });

  const amt = Number(amount) || 0;
  const rate = computeRate(from, to);
  if (!rate) return res.status(400).json({ error: 'Unsupported pair' });

  const gross = amt * rate;
  const fee = gross * FEE_RATE;
  const net = gross - fee;

  res.json({ from, to, rate, fee, gross, net });
});

// Execute swap
router.post('/', auth, async (req, res) => {
  try {
    const { from, to, amount } = req.body;
    if (!from || !to || from === to)
      return res.status(400).json({ error: 'Invalid pair' });

    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const rate = computeRate(from, to);
    if (!rate) return res.status(400).json({ error: 'Unsupported pair' });

    const user = await User.findById(req.user._id);
    if (user.balances[from] < amt)
      return res.status(400).json({ error: `Insufficient ${from} balance` });

    const gross = amt * rate;
    const fee = gross * FEE_RATE;
    const net = gross - fee;

    user.balances[from] -= amt;
    user.balances[to] += net;
    await user.save();

    const swap = await Swap.create({
      user: user._id, from, to,
      fromAmount: amt, toAmount: net, rate
    });

    await Transaction.create({
      user: user._id, type: 'earn', currency: to,
      amount: net, status: 'completed',
      note: `Swap ${amt} ${from} → ${net.toFixed(6)} ${to} @ ${rate}`
    });

    res.json({ swap, balances: user.balances, fee });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// History
router.get('/history', auth, async (req, res) => {
  const swaps = await Swap.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json(swaps);
});

function computeRate(from, to) {
  if (from === 'USDT' && USD_PRICE[to]) return 1 / USD_PRICE[to];
  if (to === 'USDT' && USD_PRICE[from]) return USD_PRICE[from];
  if (USD_PRICE[from] && USD_PRICE[to]) return USD_PRICE[from] / USD_PRICE[to];
  return null;
}

module.exports = router;