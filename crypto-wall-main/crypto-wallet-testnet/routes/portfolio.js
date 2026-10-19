const express = require('express');
const PortfolioSnapshot = require('../models/PortfolioSnapshot');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

const PRICES = { USDT: 1, BTC: 68000, ETH: 3500 };

async function snapshotToday(user) {
  const today = new Date().toISOString().slice(0, 10);
  const usd = (user.balances.USDT || 0) * PRICES.USDT
            + (user.balances.BTC  || 0) * PRICES.BTC
            + (user.balances.ETH  || 0) * PRICES.ETH;

  await PortfolioSnapshot.findOneAndUpdate(
    { user: user._id, date: today },
    {
      user: user._id,
      date: today,
      usdValue: usd,
      balances: {
        USDT: user.balances.USDT,
        BTC:  user.balances.BTC,
        ETH:  user.balances.ETH
      }
    },
    { upsert: true, new: true }
  );
  return usd;
}

router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  const currentUsd = await snapshotToday(user);

  // Seed 30 days of history if not enough
  const existing = await PortfolioSnapshot.find({ user: user._id }).sort({ date: 1 });
  if (existing.length < 15) {
    const now = new Date();
    const seed = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const jitter = 1 + (Math.random() - 0.5) * 0.08;
      const baseUsd = Math.max(1, currentUsd * 0.7) * jitter * (1 + (29 - i) * 0.01);
      seed.push({ user: user._id, date: key, usdValue: baseUsd, balances: user.balances });
    }
    for (const s of seed) {
      await PortfolioSnapshot.updateOne(
        { user: user._id, date: s.date },
        { $setOnInsert: s },
        { upsert: true }
      );
    }
  }

  const history = await PortfolioSnapshot.find({ user: user._id }).sort({ date: 1 });
  const prices = PRICES;

  const holdings = [
    { symbol: 'USDT', amount: user.balances.USDT, price: 1,                 usd: user.balances.USDT },
    { symbol: 'BTC',  amount: user.balances.BTC,  price: prices.BTC,        usd: user.balances.BTC * prices.BTC },
    { symbol: 'ETH',  amount: user.balances.ETH,  price: prices.ETH,        usd: user.balances.ETH * prices.ETH }
  ];

  const total = holdings.reduce((s, h) => s + h.usd, 0);

  res.json({
    total,
    holdings: holdings.map(h => ({ ...h, pct: total > 0 ? (h.usd / total) * 100 : 0 })),
    history: history.map(s => ({ date: s.date, usd: s.usdValue }))
  });
});

module.exports = router;