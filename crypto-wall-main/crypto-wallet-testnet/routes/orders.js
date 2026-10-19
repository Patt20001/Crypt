const express = require('express');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

// In-memory cache so we don't hammer Binance on every request
const priceCache = {
  'BTC/USDT': { price: 68000, ts: 0 },
  'ETH/USDT': { price: 3500,  ts: 0 }
};
const CACHE_TTL = 3000; // 3 seconds
let binanceBlocked = false; // once we detect 451, skip Binance for this session
let bybitBlocked = false;
let coingeckoBlocked = false;

/* ============================================================
   Fetch live price from Binance
   Falls back to Bybit if Binance is geo-blocked
   ============================================================ */
async function fetchLivePrice(pair) {
  const cache = priceCache[pair];
  if (cache && Date.now() - cache.ts < CACHE_TTL && cache.ts > 0) return cache.price;

  const symbol = pair.replace('/', '').toUpperCase();

  // ============================================================
  // 1. Try Binance (unless already known blocked)
  // ============================================================
  if (!binanceBlocked) {
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
      );
      if (res.status === 451) {
        binanceBlocked = true;
        console.log('⚠️ Binance geo-blocked — trying Bybit');
      } else if (res.ok) {
        const json = await res.json();
        const price = parseFloat(json.price);
        if (price) {
          priceCache[pair] = { price, ts: Date.now() };
          return price;
        }
      }
    } catch (e) {
      console.warn(`Binance fetch error for ${pair}:`, e.message);
    }
  }

  // ============================================================
  // 2. Try Bybit (unless already known blocked)
  // ============================================================
  if (!bybitBlocked) {
    try {
      const res = await fetch(
        `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
      );
      if (res.status === 451 || res.status === 403) {
        bybitBlocked = true;
        console.log('⚠️ Bybit blocked too — trying CoinGecko');
      } else if (res.ok) {
        const json = await res.json();
        const price = parseFloat(json.result?.list?.[0]?.lastPrice);
        if (price) {
          priceCache[pair] = { price, ts: Date.now() };
          return price;
        }
      }
    } catch (e) {
      console.warn(`Bybit fetch error for ${pair}:`, e.message);
    }
  }

  // ============================================================
  // 3. Try CoinGecko (unless already known blocked)
  // ============================================================
  if (!coingeckoBlocked) {
    try {
      const coinId = pair.startsWith('BTC') ? 'bitcoin'
                   : pair.startsWith('ETH') ? 'ethereum'
                   : null;
      if (coinId) {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`
        );
        if (res.status === 429) {
          // Rate limited — not permanently blocked
          console.warn(`CoinGecko rate-limited for ${pair}`);
        } else if (res.ok) {
          const json = await res.json();
          const price = json[coinId]?.usd;
          if (price) {
            priceCache[pair] = { price, ts: Date.now() };
            return price;
          }
        }
      }
    } catch (e) {
      console.warn(`CoinGecko fetch error for ${pair}:`, e.message);
    }
  }

  // ============================================================
  // 4. Final fallback: last cached price or hardcoded seed
  // ============================================================
  return cache?.price || (pair === 'BTC/USDT' ? 68000 : 3500);
}

/* ============================================================
   Build a simulated order book around the live mid price
   ============================================================ */
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
   GET /api/orders/book/:pair — order book
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
   GET /api/orders/trades/:pair — recent trades (simulated)
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
   GET /api/orders/my — my orders
   ============================================================ */
router.get('/my', auth, async (req, res) => {
  const orders = await Order.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(orders);
});

/* ============================================================
   POST /api/orders — place an order
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

    // Balance checks & locking
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

    // Auto-fill if price is within 0.3% of market
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
   POST /api/orders/:id/cancel — cancel an order
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
   tryFillOrder — internal helper to fill an order
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