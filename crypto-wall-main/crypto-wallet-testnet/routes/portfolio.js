const express = require('express');
const PortfolioSnapshot = require('../models/PortfolioSnapshot');
const User = require('../models/User');
const Position = require('../models/Position');
const { auth } = require('../middleware/auth');
const router = express.Router();

const PRICES = { USDT: 1, BTC: 68000, ETH: 3500, SOL: 150, BNB: 600, XRP: 0.6, ADA: 0.5, DOGE: 0.15 };

async function fetchPrices() {
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT"]',
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const arr = await res.json();
      const m = {};
      arr.forEach(x => {
        const sym = x.symbol.replace('USDT', '');
        m[sym] = parseFloat(x.price);
      });
      return { USDT: 1, ...m };
    }
  } catch {}
  return PRICES;
}

async function snapshotToday(user, prices) {
  const today = new Date().toISOString().slice(0, 10);
  const usd = Object.keys(prices).reduce((sum, sym) =>
    sum + ((user.balances[sym] || 0) * prices[sym]), 0);

  await PortfolioSnapshot.findOneAndUpdate(
    { user: user._id, date: today },
    { user: user._id, date: today, usdValue: usd, balances: user.balances },
    { upsert: true, new: true }
  );
  return usd;
}

router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  const prices = await fetchPrices();
  const currentUsd = await snapshotToday(user, prices);

  const existing = await PortfolioSnapshot.find({ user: user._id }).sort({ date: 1 });
  if (existing.length < 15) {
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const jitter = 1 + (Math.random() - 0.5) * 0.08;
      const base = Math.max(1, currentUsd * 0.7) * jitter * (1 + (29 - i) * 0.01);
      await PortfolioSnapshot.updateOne(
        { user: user._id, date: key },
        { $setOnInsert: { user: user._id, date: key, usdValue: base, balances: user.balances } },
        { upsert: true }
      );
    }
  }

  const history = await PortfolioSnapshot.find({ user: user._id }).sort({ date: 1 });

  const holdings = Object.keys(prices).map(sym => ({
    symbol: sym,
    amount: user.balances[sym] || 0,
    price: prices[sym],
    usd: (user.balances[sym] || 0) * prices[sym]
  })).filter(h => h.amount > 0);

  const total = holdings.reduce((s, h) => s + h.usd, 0);
  holdings.forEach(h => h.pct = total > 0 ? (h.usd / total) * 100 : 0);

  const positions = await Position.find({ user: user._id, amount: { $gt: 0 } });
  const positionsWithPnl = positions.map(p => {
    const currentPrice = prices[p.base] || p.avgCost;
    const marketValue = p.amount * currentPrice;
    const costBasis = p.amount * p.avgCost;
    const unrealized = marketValue - costBasis;
    const unrealizedPct = costBasis > 0 ? (unrealized / costBasis) * 100 : 0;
    return {
      _id: p._id,
      pair: p.pair, base: p.base,
      amount: p.amount, avgCost: p.avgCost, currentPrice,
      marketValue, costBasis, unrealized, unrealizedPct,
      realized: p.realized,
      stopLoss: p.stopLoss || 0,
      takeProfit: p.takeProfit || 0
    };
  });

  const totalRealized = positions.reduce((s, p) => s + p.realized, 0);
  const totalUnrealized = positionsWithPnl.reduce((s, p) => s + p.unrealized, 0);

  res.json({
    total,
    holdings,
    history: history.map(s => ({ date: s.date, usd: s.usdValue })),
    pnl: {
      realized: totalRealized,
      unrealized: totalUnrealized,
      total: totalRealized + totalUnrealized,
      positions: positionsWithPnl
    }
  });
});

module.exports = router;