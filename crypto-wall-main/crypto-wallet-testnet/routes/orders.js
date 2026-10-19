const express = require('express');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

/* ============================================================
   EXCHANGE HEALTH DETECTION
   Picks one working exchange per server session.
   ============================================================ */
const exchangeState = {
  name: null,
  lastCheck: 0,
  ttl: 60_000
};

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
        if (exchangeState.name !== t.name) {
          console.log(`✅ Market data source: ${t.name}`);
        }
        exchangeState.name = t.name;
        exchangeState.lastCheck = Date.now();
        return t.name;
      }
    } catch (e) {}
  }

  if (exchangeState.name !== 'fallback') {
    console.log('⚠️ No exchange reachable — using cached fallback prices');
  }
  exchangeState.name = 'fallback';
  exchangeState.lastCheck = Date.now();
  return 'fallback';
}

/* ============================================================
   PRICE CACHE
   ============================================================ */
const priceCache = {
  'BTC/USDT': { price: 68000, ts: 0 },
  'ETH/USDT': { price: 3500,  ts: 0 }
};
const CACHE_TTL = 3000;

async function fetchLivePrice(pair) {
  const cache = priceCache[pair];
  if (cache && Date.now() - cache.ts < CACHE_TTL && cache.ts > 0) return cache.price;

  const symbol = pair.replace('/', '').toUpperCase();
  const exchange = await detectExchange();

  try {
    if (exchange === 'binance') {
      const res = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
      );
      if (res.ok) {
        const json = await res.json();
        const price = parseFloat(json.price);
        if (price) {
          priceCache[pair] = { price, ts: Date.now() };
          return price;
        }
      }
    } else if (exchange === 'bybit') {
      const res = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
      );
      if (res.ok) {
        const json = await res.json();
        const price = parseFloat(json.result?.list?.[0]?.lastPrice);
        if (price) {
          priceCache[pair] = { price, ts: Date.now() };
          return price;
        }
      }
    } else if (exchange === 'coingecko') {
      const coinId = pair.startsWith('BTC') ? 'bitcoin'
                   : pair.startsWith('ETH') ? 'ethereum'
                   : null;
      if (coinId) {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
        );
        if (res.ok) {
          const json = await res.json();
          const price = json[coinId]?.usd;
          if (price) {
            priceCache[pair] = { price, ts: Date.now() };
            return price;
          }
        }
      }
    }
  } catch (e) {
    console.warn(`fetchLivePrice (${exchange}) failed for ${pair}:`, e.message);
  }

  return cache?.price || (pair === 'BTC/USDT' ? 68000 : 3500);
}

async function buildOrderBook(pair) {
  const mid = await fetchLivePrice(pair);
  if (!mid) return null;

  const bids = [];
  const asks = [];

  for (let i = 0; i < 12; i++) {
    const bidPrice = mid * (1 - 0.0006 * (i + 1) - Math.random() * 0.0004);
    const bidAmount = +(0.05 + Math.random() * 2).toFixed(4);
    bids.push({
      price: +bidPrice.toFixed(2),
      amount: bidAmount,
      total: +(bidPrice * bidAmount).toFixed(2)
    });

    const askPrice = mid * (1 + 0.0006 * (i + 1) + Math.random() * 0.0004);
    const askAmount = +(0.05 + Math.random() * 2).toFixed(4);
    asks.push({
      price: +askPrice.toFixed(2),
      amount: askAmount,
      total: +(askPrice * askAmount).toFixed(2)
    });
  }

  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);

  return { pair, mid, bids, asks, updatedAt: new Date() };
}

/* ============================================================
   HEALTH ENDPOINT (public — no auth, so curl works)
   ============================================================ */
router.get('/health', async (req, res) => {
  try {
    const exchange = await detectExchange();
    res.json({ exchange });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   ORDER BOOK
   ============================================================ */
router.get('/book/:pair', auth, async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/');
    const book = await buildOrderBook(pair);
    if (!book) return res.status(400).json({ error: 'Unsupported pair' });
    res.json(book);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   RECENT TRADES
   ============================================================ */
router.get('/trades/:pair', auth, async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/');
    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'Unsupported pair' });

    const trades = [];
    for (let i = 0; i < 20; i++) {
      const side = Math.random() > 0.5 ? 'buy' : 'sell';
      const price = mid * (1 + (Math.random() - 0.5) * 0.004);
      const amount = +(0.001 + Math.random() * 0.5).toFixed(4);
      const secondsAgo = Math.floor(Math.random() * 300);
      trades.push({
        side,
        price: +price.toFixed(2),
        amount,
        time: new Date(Date.now() - secondsAgo * 1000)
      });
    }
    trades.sort((a, b) => b.time - a.time);
    res.json(trades);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   MY ORDERS
   ============================================================ */
router.get('/my', auth, async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(orders);
});

/* ============================================================
   PLACE ORDER
   ============================================================ */
router.post('/', auth, async (req, res) => {
  try {
    const { side, pair, type = 'limit', price, amount } = req.body;

    if (!['buy', 'sell'].includes(side))
      return res.status(400).json({ error: 'Invalid side' });

    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'Unsupported pair' });

    const amt = Number(amount);
    const p = Number(price) || mid;

    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (p <= 0) return res.status(400).json({ error: 'Invalid price' });

    const [base, quote] = pair.split('/');
    const user = await User.findById(req.user._id);

    if (side === 'buy') {
      const cost = p * amt;
      if (user.balances[quote] < cost)
        return res.status(400).json({ error: `Insufficient ${quote} balance` });
      user.balances[quote] -= cost;
      user.locked[quote] = (user.locked[quote] || 0) + cost;
    } else {
      if (user.balances[base] < amt)
        return res.status(400).json({ error: `Insufficient ${base} balance` });
      user.balances[base] -= amt;
      user.locked[base] = (user.locked[base] || 0) + amt;
    }
    await user.save();

    const order = await Order.create({
      user: user._id, side, pair, type, price: p, amount: amt
    });

    const diff = Math.abs(p - mid) / mid;
    if (diff < 0.003) {
      setTimeout(() => tryFillOrder(order._id).catch(() => {}), 3000);
    }

    await notify(
      user._id, 'system',
      'Order placed',
      `${side.toUpperCase()} ${amt} ${base} @ ${p} ${quote} on ${pair}`
    );

    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   CANCEL ORDER
   ============================================================ */
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['open', 'partial'].includes(order.status))
      return res.status(400).json({ error: 'Cannot cancel this order' });

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

    await notify(
      user._id, 'system',
      'Order cancelled',
      `${order.side.toUpperCase()} ${order.amount} ${base} @ ${order.price} ${quote}`
    );
    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   FILL ORDER (internal)
   ============================================================ */
async function tryFillOrder(orderId) {
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
  } else {
    user.locked[base] = Math.max(0, (user.locked[base] || 0) - fillAmount);
    user.balances[quote] = (user.balances[quote] || 0) + (order.price * fillAmount);
  }
  await user.save();

  order.filled += fillAmount;
  order.status = 'filled';
  order.updatedAt = new Date();
  await order.save();

  await Transaction.create({
    user: user._id,
    type: 'earn',
    currency: order.side === 'buy' ? base : quote,
    amount: order.side === 'buy' ? fillAmount : (order.price * fillAmount),
    status: 'completed',
    note: `Order filled: ${order.side.toUpperCase()} ${fillAmount} ${base} @ ${order.price} ${quote}`
  });

  await notify(
    user._id, 'system',
    'Order filled',
    `${order.side.toUpperCase()} ${fillAmount} ${base} @ ${order.price} ${quote}`
  );
}

module.exports = router;