const express = require('express');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Position = require('../models/Position');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

/* ============================================================
   SUPPORTED MARKETS (7 pairs)
   ============================================================ */
const MARKETS = [
  { pair: 'BTC/USDT',  base: 'BTC',  quote: 'USDT', decimals: 2 },
  { pair: 'ETH/USDT',  base: 'ETH',  quote: 'USDT', decimals: 2 },
  { pair: 'SOL/USDT',  base: 'SOL',  quote: 'USDT', decimals: 2 },
  { pair: 'BNB/USDT',  base: 'BNB',  quote: 'USDT', decimals: 2 },
  { pair: 'XRP/USDT',  base: 'XRP',  quote: 'USDT', decimals: 4 },
  { pair: 'ADA/USDT',  base: 'ADA',  quote: 'USDT', decimals: 4 },
  { pair: 'DOGE/USDT', base: 'DOGE', quote: 'USDT', decimals: 4 }
];

function isSupported(pair) {
  return MARKETS.some(m => m.pair === pair);
}

/* ============================================================
   EXCHANGE HEALTH DETECTION
   ============================================================ */
const exchangeState = { name: null, lastCheck: 0, ttl: 60_000 };

async function detectExchange() {
  if (exchangeState.name && Date.now() - exchangeState.lastCheck < exchangeState.ttl) {
    return exchangeState.name;
  }

  const tests = [
    { name: 'binance',   url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT' },
    { name: 'bybit',     url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT' },
    { name: 'coingecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd' }
  ];

  for (const t of tests) {
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        if (exchangeState.name !== t.name) console.log(`✅ Market data: ${t.name}`);
        exchangeState.name = t.name;
        exchangeState.lastCheck = Date.now();
        return t.name;
      }
    } catch {}
  }

  exchangeState.name = 'fallback';
  exchangeState.lastCheck = Date.now();
  return 'fallback';
}

/* ============================================================
   PRICE CACHE (per pair)
   ============================================================ */
const priceCache = {};
MARKETS.forEach(m => { priceCache[m.pair] = { price: 0, ts: 0 }; });
const CACHE_TTL = 3000;

async function fetchLivePrice(pair) {
  if (!isSupported(pair)) return null;
  const cache = priceCache[pair];
  if (cache && Date.now() - cache.ts < CACHE_TTL && cache.ts > 0) return cache.price;

  const symbol = pair.replace('/', '').toUpperCase();
  const exchange = await detectExchange();

  try {
    if (exchange === 'binance') {
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      if (res.ok) {
        const j = await res.json();
        const p = parseFloat(j.price);
        if (p) { priceCache[pair] = { price: p, ts: Date.now() }; return p; }
      }
    } else if (exchange === 'bybit') {
      const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
      if (res.ok) {
        const j = await res.json();
        const p = parseFloat(j.result?.list?.[0]?.lastPrice);
        if (p) { priceCache[pair] = { price: p, ts: Date.now() }; return p; }
      }
    } else if (exchange === 'coingecko') {
      const coinId = pair.split('/')[0].toLowerCase();
      const map = { btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
                    xrp: 'ripple', ada: 'cardano', doge: 'dogecoin' };
      const id = map[coinId];
      if (id) {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`);
        if (res.ok) {
          const j = await res.json();
          const p = j[id]?.usd;
          if (p) { priceCache[pair] = { price: p, ts: Date.now() }; return p; }
        }
      }
    }
  } catch (e) {
    console.warn(`fetchLivePrice (${exchange}) ${pair}:`, e.message);
  }

  return cache?.price || 0;
}

/* ============================================================
   POSITION HELPERS (for PnL)
   ============================================================ */
async function upsertPosition(userId, pair, base, deltaAmount, price) {
  // deltaAmount > 0 = buy, < 0 = sell
  let pos = await Position.findOne({ user: userId, pair });
  if (!pos) {
    pos = new Position({ user: userId, pair, base, amount: 0, avgCost: 0, realized: 0 });
  }

  if (deltaAmount > 0) {
    // Buying: update average cost
    const newAmount = pos.amount + deltaAmount;
    const newCost = (pos.amount * pos.avgCost) + (deltaAmount * price);
    pos.avgCost = newCost / newAmount;
    pos.amount = newAmount;
  } else {
    // Selling: realize PnL
    const sellAmount = Math.abs(deltaAmount);
    const realizedPnl = sellAmount * (price - pos.avgCost);
    pos.realized += realizedPnl;
    pos.amount = Math.max(0, pos.amount - sellAmount);
    if (pos.amount === 0) pos.avgCost = 0;
  }

  pos.updatedAt = new Date();
  await pos.save();
  return pos;
}

/* ============================================================
   ROUTES
   ============================================================ */

// GET markets
router.get('/markets', auth, async (req, res) => {
  try {
    const withPrices = await Promise.all(MARKETS.map(async m => ({
      ...m,
      price: await fetchLivePrice(m.pair)
    })));
    res.json(withPrices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET health
router.get('/health', async (req, res) => {
  try {
    res.json({ exchange: await detectExchange() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET order book
router.get('/book/:pair', auth, async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/');
    if (!isSupported(pair)) return res.status(400).json({ error: 'Unsupported pair' });
    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'No price' });

    const bids = [], asks = [];
    for (let i = 0; i < 12; i++) {
      const bd = mid * (1 - 0.0006 * (i + 1) - Math.random() * 0.0004);
      const bA = +(0.05 + Math.random() * 2).toFixed(4);
      bids.push({ price: +bd.toFixed(2), amount: bA, total: +(bd * bA).toFixed(2) });
      const ad = mid * (1 + 0.0006 * (i + 1) + Math.random() * 0.0004);
      const aA = +(0.05 + Math.random() * 2).toFixed(4);
      asks.push({ price: +ad.toFixed(2), amount: aA, total: +(ad * aA).toFixed(2) });
    }
    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    res.json({ pair, mid, bids, asks, updatedAt: new Date() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET trades
router.get('/trades/:pair', auth, async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/');
    if (!isSupported(pair)) return res.status(400).json({ error: 'Unsupported pair' });
    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'No price' });

    const trades = [];
    for (let i = 0; i < 20; i++) {
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      const price = mid * (1 + (Math.random() - 0.5) * 0.004);
      const amount = +(0.001 + Math.random() * 0.5).toFixed(4);
      const ago = Math.floor(Math.random() * 300);
      trades.push({ side, price: +price.toFixed(2), amount, time: new Date(Date.now() - ago * 1000) });
    }
    trades.sort((a, b) => b.time - a.time);
    res.json(trades);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET my orders
router.get('/my', auth, async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json(orders);
});

// POST place order (market OR limit OR SL/TP)
router.post('/', auth, async (req, res) => {
  try {
    const { side, pair, type = 'limit', price, amount, conditionalType, triggerPrice } = req.body;

    if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Invalid side' });
    if (!isSupported(pair)) return res.status(400).json({ error: 'Unsupported pair' });

    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'Price unavailable' });

    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const [base, quote] = pair.split('/');
    const user = await User.findById(req.user._id);

    // MARKET ORDER — instant fill at mid
    if (type === 'market') {
      const fillPrice = mid;
      const cost = fillPrice * amt;

      if (side === 'buy') {
        if (user.balances[quote] < cost)
          return res.status(400).json({ error: `Insufficient ${quote}` });
        user.balances[quote] -= cost;
        user.balances[base] = (user.balances[base] || 0) + amt;
      } else {
        if (user.balances[base] < amt)
          return res.status(400).json({ error: `Insufficient ${base}` });
        user.balances[base] -= amt;
        user.balances[quote] = (user.balances[quote] || 0) + cost;
      }
      await user.save();
      await upsertPosition(user._id, pair, base, side === 'buy' ? amt : -amt, fillPrice);

      const order = await Order.create({
        user: user._id, side, pair, type: 'market',
        price: fillPrice, amount: amt, filled: amt, status: 'filled'
      });

      await Transaction.create({
        user: user._id, type: 'earn',
        currency: side === 'buy' ? base : quote,
        amount: side === 'buy' ? amt : cost,
        status: 'completed',
        note: `Market ${side.toUpperCase()} ${amt} ${base} @ ${fillPrice} ${quote}`
      });

      await notify(user._id, 'system', 'Market order filled',
        `${side.toUpperCase()} ${amt} ${base} @ ${fillPrice} ${quote}`);

      return res.json(order);
    }

    // SL/TP order — lock funds, wait for trigger
    if (conditionalType === 'stop_loss' || conditionalType === 'take_profit') {
      const tp = Number(triggerPrice);
      if (!tp || tp <= 0) return res.status(400).json({ error: 'Invalid trigger price' });

      if (side === 'buy') {
        const cost = tp * amt;
        if (user.balances[quote] < cost)
          return res.status(400).json({ error: `Insufficient ${quote}` });
        user.balances[quote] -= cost;
        user.locked[quote] = (user.locked[quote] || 0) + cost;
      } else {
        if (user.balances[base] < amt)
          return res.status(400).json({ error: `Insufficient ${base}` });
        user.balances[base] -= amt;
        user.locked[base] = (user.locked[base] || 0) + amt;
      }
      await user.save();

      const order = await Order.create({
        user: user._id, side, pair, type: 'limit',
        price: tp, amount: amt,
        conditionalType, triggerPrice: tp
      });
      await notify(user._id, 'system',
        `${conditionalType === 'stop_loss' ? 'Stop-Loss' : 'Take-Profit'} set`,
        `${side.toUpperCase()} ${amt} ${base} trigger @ ${tp} ${quote}`);
      return res.json(order);
    }

    // LIMIT order (unchanged)
    const p = Number(price) || mid;
    if (p <= 0) return res.status(400).json({ error: 'Invalid price' });

    if (side === 'buy') {
      const cost = p * amt;
      if (user.balances[quote] < cost)
        return res.status(400).json({ error: `Insufficient ${quote}` });
      user.balances[quote] -= cost;
      user.locked[quote] = (user.locked[quote] || 0) + cost;
    } else {
      if (user.balances[base] < amt)
        return res.status(400).json({ error: `Insufficient ${base}` });
      user.balances[base] -= amt;
      user.locked[base] = (user.locked[base] || 0) + amt;
    }
    await user.save();

    const order = await Order.create({
      user: user._id, side, pair, type: 'limit', price: p, amount: amt
    });

    const diff = Math.abs(p - mid) / mid;
    if (diff < 0.003) {
      setTimeout(() => tryFillLimit(order._id).catch(() => {}), 3000);
    }

    await notify(user._id, 'system', 'Limit order placed',
      `${side.toUpperCase()} ${amt} ${base} @ ${p} ${quote}`);
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST cancel
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['open', 'partial'].includes(order.status))
      return res.status(400).json({ error: 'Cannot cancel' });

    const [base, quote] = order.pair.split('/');
    const user = await User.findById(req.user._id);
    const remaining = order.amount - order.filled;

    if (order.side === 'buy') {
      const refund = order.price * remaining;
      user.locked[quote] = Math.max(0, (user.locked[quote] || 0) - refund);
      user.balances[quote] += refund;
    } else {
      user.locked[base] = Math.max(0, (user.locked[base] || 0) - remaining);
      user.balances[base] += remaining;
    }
    await user.save();

    order.status = 'cancelled';
    order.updatedAt = new Date();
    await order.save();

    await notify(user._id, 'system', 'Order cancelled',
      `${order.side.toUpperCase()} ${order.amount} ${base}`);
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Internal: fill limit order
async function tryFillLimit(orderId) {
  const order = await Order.findById(orderId);
  if (!order || !['open', 'partial'].includes(order.status)) return;

  const [base, quote] = order.pair.split('/');
  const user = await User.findById(order.user);
  const remaining = order.amount - order.filled;
  const fillAmount = remaining;

  if (order.side === 'buy') {
    const cost = order.price * fillAmount;
    user.locked[quote] = Math.max(0, (user.locked[quote] || 0) - cost);
    user.balances[base] = (user.balances[base] || 0) + fillAmount;
    await upsertPosition(user._id, order.pair, base, fillAmount, order.price);
  } else {
    user.locked[base] = Math.max(0, (user.locked[base] || 0) - fillAmount);
    user.balances[quote] = (user.balances[quote] || 0) + (order.price * fillAmount);
    await upsertPosition(user._id, order.pair, base, -fillAmount, order.price);
  }
  await user.save();

  order.filled += fillAmount;
  order.status = 'filled';
  order.updatedAt = new Date();
  await order.save();

  await Transaction.create({
    user: user._id, type: 'earn',
    currency: order.side === 'buy' ? base : quote,
    amount: order.side === 'buy' ? fillAmount : (order.price * fillAmount),
    status: 'completed',
    note: `Order filled: ${order.side.toUpperCase()} ${fillAmount} ${base} @ ${order.price} ${quote}`
  });

  await notify(user._id, 'system', 'Order filled',
    `${order.side.toUpperCase()} ${fillAmount} ${base} @ ${order.price} ${quote}`);
}

module.exports = router;