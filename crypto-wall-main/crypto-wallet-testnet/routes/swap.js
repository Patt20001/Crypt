const express = require('express');
const mongoose = require('mongoose');
const Swap = require('../models/Swap');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const router = express.Router();

const ASSETS = {
  USDT: { id: 'tether', fallback: 1 },
  BTC: { id: 'bitcoin', fallback: 68000 },
  ETH: { id: 'ethereum', fallback: 3500 },
  SOL: { id: 'solana', fallback: 150 },
  BNB: { id: 'binancecoin', fallback: 600 },
  XRP: { id: 'ripple', fallback: 0.6 },
  ADA: { id: 'cardano', fallback: 0.45 },
  DOGE: { id: 'dogecoin', fallback: 0.15 },
  LTC: { id: 'litecoin', fallback: 80 },
  TRX: { id: 'tron', fallback: 0.12 },
  DOT: { id: 'polkadot', fallback: 7 },
  AVAX: { id: 'avalanche-2', fallback: 35 },
  LINK: { id: 'chainlink', fallback: 15 },
  BCH: { id: 'bitcoin-cash', fallback: 400 },
  TON: { id: 'the-open-network', fallback: 5 },
  NEAR: { id: 'near', fallback: 5 },
  ATOM: { id: 'cosmos', fallback: 8 },
  UNI: { id: 'uniswap', fallback: 10 }
};
const FEE_RATE = 0.005;
let priceCache = { at: 0, values: null, source: 'Fallback reference rates' };

async function getPrices() {
  if (priceCache.values && Date.now() - priceCache.at < 30000) return priceCache.values;
  const values = Object.fromEntries(Object.entries(ASSETS).map(([symbol, asset]) => [symbol, asset.fallback]));
  let source = 'Fallback reference rates';
  try {
    const ids = [...new Set(Object.values(ASSETS).map(a => a.id))].join(',');
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd`, { signal: AbortSignal.timeout(7000) });
    if (response.ok) {
      const data = await response.json();
      source = 'Live market feed';
      for (const [symbol, asset] of Object.entries(ASSETS)) {
        const live = Number(data?.[asset.id]?.usd);
        if (Number.isFinite(live) && live > 0) values[symbol] = live;
      }
    }
  } catch (e) {
    console.warn('Swap price feed unavailable; using cached/reference rates:', e.message);
  }
  priceCache = { at: Date.now(), values, source };
  return values;
}
function round(value, decimals = 12) {
  return Number(Number(value).toFixed(decimals));
}
function computeRate(from, to, prices) {
  if (!ASSETS[from] || !ASSETS[to] || from === to) return null;
  return Number(prices[from]) / Number(prices[to]);
}

router.get('/assets', auth, (req, res) => {
  res.json(Object.entries(ASSETS).map(([symbol, asset]) => ({ symbol, name: symbol, id: asset.id })));
});

router.get('/quote', auth, async (req, res) => {
  try {
    const from = String(req.query.from || '').toUpperCase();
    const to = String(req.query.to || '').toUpperCase();
    if (!ASSETS[from] || !ASSETS[to] || from === to) return res.status(400).json({ error: 'Invalid or unsupported pair' });
    const amt = Number(req.query.amount) || 0;
    if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: 'Invalid amount' });
    const prices = await getPrices();
    const rate = computeRate(from, to, prices);
    const gross = amt * rate;
    const fee = gross * FEE_RATE;
    res.json({ from, to, rate, fee, gross, net: gross - fee, feeRate: FEE_RATE, priceSource: priceCache.source });
  } catch (e) { res.status(500).json({ error: 'Could not calculate swap quote' }); }
});

router.post('/', auth, async (req, res) => {
  const from = String(req.body.from || '').toUpperCase();
  const to = String(req.body.to || '').toUpperCase();
  const amt = Number(req.body.amount);
  if (!ASSETS[from] || !ASSETS[to] || from === to) return res.status(400).json({ error: 'Invalid or unsupported pair' });
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e15) return res.status(400).json({ error: 'Invalid amount' });

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const user = await User.findById(req.user._id).session(session);
      if (!user) throw new Error('User not found');
      const available = Number(user.balances?.[from] || 0);
      if (available + 1e-12 < amt) throw new Error(`Insufficient ${from} balance`);
      const prices = await getPrices();
      const rate = computeRate(from, to, prices);
      const gross = amt * rate;
      const fee = gross * FEE_RATE;
      const net = gross - fee;
      if (!Number.isFinite(net) || net <= 0) throw new Error('Unable to calculate swap amount');

      user.set(`balances.${from}`, round(available - amt));
      user.set(`balances.${to}`, round(Number(user.balances?.[to] || 0) + net));
      await user.save({ session });

      const [swap] = await Swap.create([{
        user: user._id, from, to, fromAmount: amt, toAmount: round(net), rate
      }], { session, ordered: true });
      const referenceId = String(swap._id);
      await Transaction.create([
        { user: user._id, type: 'earn', category: 'swap', direction: 'debit', currency: from, amount: amt, status: 'completed', referenceId, note: `Swap debit ${amt} ${from} → ${to}` },
        { user: user._id, type: 'earn', category: 'swap', direction: 'credit', currency: to, amount: round(net), fee: round(fee), status: 'completed', referenceId, note: `Swap credit ${round(net)} ${to} from ${from}` }
      ], { session, ordered: true });
      result = { swap, balances: user.balances, fee: round(fee) };
    });
    res.json(result);
  } catch (e) {
    res.status(/insufficient|invalid|not found/i.test(e.message) ? 400 : 500).json({ error: e.message });
  } finally { await session.endSession(); }
});

router.get('/history', auth, async (req, res) => {
  try {
    const swaps = await Swap.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
    res.json(swaps);
  } catch (e) { res.status(500).json({ error: 'Could not load swap history' }); }
});

module.exports = router;
