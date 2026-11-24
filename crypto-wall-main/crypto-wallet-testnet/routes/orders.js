const express = require('express');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Position = require('../models/Position');
const Settings = require('../models/Settings');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

// Prices are reference prices. Order-book depth and recent trades are indicative.
const MARKET_ASSETS = [
  ['BTC','bitcoin',2], ['ETH','ethereum',2], ['SOL','solana',3], ['BNB','binancecoin',2],
  ['XRP','ripple',4], ['ADA','cardano',4], ['DOGE','dogecoin',5], ['LTC','litecoin',2],
  ['TRX','tron',5], ['DOT','polkadot',3], ['AVAX','avalanche-2',3], ['LINK','chainlink',3],
  ['BCH','bitcoin-cash',2], ['TON','the-open-network',3], ['NEAR','near',3], ['ATOM','cosmos',3], ['UNI','uniswap',3]
];
const MARKETS = MARKET_ASSETS.map(([base, coinId, decimals]) => ({ pair: `${base}/USDT`, base, quote: 'USDT', decimals, coinId }));
const marketByPair = new Map(MARKETS.map(m => [m.pair, m]));
const isSupported = pair => marketByPair.has(pair);
const priceCache = Object.fromEntries(MARKETS.map(m => [m.pair, { price: 0, ts: 0 }]));
const CACHE_TTL = 2500;
let priceProvider = 'binance';
let providerCheckedAt = 0;

async function detectExchange() {
  if (Date.now() - providerCheckedAt < 60000) return priceProvider;
  const checks = [
    ['binance','https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'],
    ['bybit','https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'],
    ['coingecko','https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd']
  ];
  for (const [name,url] of checks) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) continue;
      const j = await r.json();
      const valid = name === 'binance' ? Number(j.price) > 0 : name === 'bybit' ? Number(j.result?.list?.[0]?.lastPrice) > 0 : Number(j.bitcoin?.usd) > 0;
      if (valid) { priceProvider = name; providerCheckedAt = Date.now(); return name; }
    } catch {}
  }
  priceProvider = 'fallback'; providerCheckedAt = Date.now(); return priceProvider;
}

async function fetchLivePrice(pair) {
  const market = marketByPair.get(pair);
  if (!market) return null;
  const cached = priceCache[pair];
  if (cached.price > 0 && Date.now() - cached.ts < CACHE_TTL) return cached.price;
  const symbol = `${market.base}USDT`;
  const providers = [
    async () => {
      const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return 0;
      return Number((await r.json()).price);
    },
    async () => {
      const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return 0;
      return Number((await r.json()).result?.list?.[0]?.lastPrice);
    },
    async () => {
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${market.coinId}&vs_currencies=usd`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return 0;
      return Number((await r.json())[market.coinId]?.usd);
    }
  ];
  for (let i = 0; i < providers.length; i++) {
    try {
      const price = await providers[i]();
      if (Number.isFinite(price) && price > 0) {
        priceCache[pair] = { price, ts: Date.now() };
        priceProvider = ['binance','bybit','coingecko'][i];
        return price;
      }
    } catch {}
  }
  return cached.price || null;
}

function finitePositive(value) { const n = Number(value); return Number.isFinite(n) && n > 0; }
function roundMoney(n) { return Math.round((n + Number.EPSILON) * 1e8) / 1e8; }
function assertTransactionSupport() {
  // MongoDB multi-document transactions require a replica set or sharded cluster.
  if (mongoose.connection.readyState !== 1) throw new Error('Database is not connected');
}
async function inTransaction(work) {
  assertTransactionSupport();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (e) {
    if (/replica set|Transaction numbers are only allowed|does not support transactions/i.test(e.message)) {
      throw new Error('Trading is paused because MongoDB transactions are unavailable. Configure MongoDB as a replica set (or use a replica-set MongoDB cluster) before enabling internal trading.');
    }
    throw e;
  } finally { await session.endSession(); }
}

async function addToPosition(userId, pair, amount, price, sl, tp, session) {
  const base = pair.split('/')[0];
  let pos = await Position.findOne({ user: userId, pair }).session(session);
  if (!pos) pos = new Position({ user: userId, pair, base, amount: 0, avgCost: 0, realized: 0 });
  const nextAmount = pos.amount + amount;
  if (amount > 0) {
    pos.avgCost = nextAmount > 0 ? ((pos.amount * pos.avgCost) + amount * price) / nextAmount : price;
    pos.amount = nextAmount;
    if (sl > 0) pos.stopLoss = sl;
    if (tp > 0) pos.takeProfit = tp;
  } else {
    const sold = Math.abs(amount);
    if (sold > pos.amount + 1e-10) throw new Error('Sell amount exceeds tracked position');
    pos.realized += sold * (price - pos.avgCost);
    pos.amount = Math.max(0, pos.amount - sold);
    if (pos.amount <= 1e-10) { pos.amount = 0; pos.avgCost = 0; pos.stopLoss = 0; pos.takeProfit = 0; }
  }
  pos.updatedAt = new Date();
  await pos.save({ session });
  return pos;
}

async function writeTradeTransaction({ userId, pair, side, amount, price, orderType, note, orderId }, session) {
  const [base, quote] = pair.split('/');
  const value = roundMoney(amount * price);
  await Transaction.create([{
    user: userId, type: 'earn', category: 'trade', direction: side === 'buy' ? 'debit' : 'credit',
    currency: quote, amount: value, pair, side, quantity: amount, price, referenceId: String(orderId || ''), status: 'completed',
    note: note || `${orderType.toUpperCase()} ${side.toUpperCase()} ${amount} ${base} @ ${price} ${quote}`
  }], { session });
}

// Execute a previously reserved limit order only when its limit is marketable.
async function tryFillLimit(orderId, referencePrice) {
  return inTransaction(async session => {
    const order = await Order.findOne({ _id: orderId, status: { $in: ['open','partial'] } }).session(session);
    if (!order || order.type !== 'limit') return null;
    const price = Number(referencePrice || await fetchLivePrice(order.pair));
    if (!finitePositive(price)) return null;
    const eligible = order.side === 'buy' ? price <= order.price : price >= order.price;
    if (!eligible) return null;
    const remaining = roundMoney(order.amount - order.filled);
    if (remaining <= 1e-10) return null;
    const [base, quote] = order.pair.split('/');
    const user = await User.findById(order.user).session(session);
    if (!user) throw new Error('Order owner not found');
    if (!user.balances) user.balances = {};
    if (!user.locked) user.locked = {};
    const executionPrice = price;
    if (order.side === 'buy') {
      const reserved = roundMoney(order.price * remaining);
      const actual = roundMoney(executionPrice * remaining);
      if ((user.locked[quote] || 0) + 1e-8 < reserved) throw new Error('Reserved quote balance is inconsistent');
      user.locked[quote] = roundMoney((user.locked[quote] || 0) - reserved);
      user.balances[quote] = roundMoney((user.balances[quote] || 0) + reserved - actual);
      user.balances[base] = roundMoney((user.balances[base] || 0) + remaining);
      await addToPosition(user._id, order.pair, remaining, executionPrice, order.stopLoss, order.takeProfit, session);
    } else {
      if ((user.locked[base] || 0) + 1e-8 < remaining) throw new Error('Reserved asset balance is inconsistent');
      user.locked[base] = roundMoney((user.locked[base] || 0) - remaining);
      user.balances[quote] = roundMoney((user.balances[quote] || 0) + executionPrice * remaining);
      const pos = await Position.findOne({ user: user._id, pair: order.pair }).session(session);
      if (pos && pos.amount > 0) await addToPosition(user._id, order.pair, -Math.min(remaining, pos.amount), executionPrice, 0, 0, session);
    }
    await user.save({ session });
    const oldFilled = order.filled || 0;
    order.avgFillPrice = oldFilled > 0
      ? ((oldFilled * (order.avgFillPrice || order.price)) + remaining * executionPrice) / (oldFilled + remaining)
      : executionPrice;
    order.filled = roundMoney(oldFilled + remaining);
    order.status = order.filled + 1e-10 >= order.amount ? 'filled' : 'partial';
    order.updatedAt = new Date();
    await order.save({ session });
    await writeTradeTransaction({ userId: user._id, pair: order.pair, side: order.side, amount: remaining, price: executionPrice, orderType: 'limit', orderId: order._id }, session);
    return { order: order.toObject(), userId: String(user._id), amount: remaining, price: executionPrice };
  });
}

// Markets and reference prices
router.get('/markets', auth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toUpperCase();
    const list = MARKETS.filter(m => !q || m.pair.includes(q) || m.base.includes(q));
    res.json(await Promise.all(list.map(async m => ({ ...m, price: await fetchLivePrice(m.pair) }))));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Candles are fetched server-side to avoid browser CORS/network restrictions.
// If an exchange does not provide the selected market/interval, return a clearly
// reference-price series so the chart remains usable.
router.get('/candles/:pair', auth, async (req, res) => {
  const pair = String(req.params.pair || '').replace('-', '/').toUpperCase();
  const market = marketByPair.get(pair);
  const interval = String(req.query.interval || '1m');
  const intervalMs = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 }[interval];
  if (!market) return res.status(400).json({ error: 'Unsupported trading pair' });
  if (!intervalMs) return res.status(400).json({ error: 'Unsupported chart interval' });
  const symbol = `${market.base}USDT`;
  const limit = 150;
  const sources = [
    async () => {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
      return (await r.json()).map(k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
    },
    async () => {
      const bybitInterval = { '1m':'1', '5m':'5', '15m':'15', '1h':'60', '4h':'240', '1d':'D' }[interval];
      const r = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`Bybit HTTP ${r.status}`);
      const j = await r.json();
      if (j.retCode !== 0) throw new Error(j.retMsg || 'Bybit candle request failed');
      return (j.result?.list || []).slice().reverse().map(k => ({ time: Math.floor(+k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
    }
  ];
  for (const source of sources) {
    try {
      const candles = await source();
      if (candles.length) return res.json({ pair, interval, source: 'market-reference', candles });
    } catch (e) { console.warn(`Candle provider failed for ${pair} (${interval}):`, e.message); }
  }
  try {
    const reference = await fetchLivePrice(pair);
    if (!finitePositive(reference)) throw new Error('No reference price available for chart');
    const end = Math.floor(Date.now() / intervalMs) * intervalMs;
    let previous = reference;
    const candles = [];
    // A bounded random walk around the current reference price for development.
    for (let i = limit - 1; i >= 0; i--) {
      const time = Math.floor((end - i * intervalMs) / 1000);
      const open = previous;
      const change = (Math.random() - 0.5) * 0.012;
      const close = Math.max(reference * 0.5, Math.min(reference * 1.5, open * (1 + change)));
      const wick = Math.abs(close - open) * (0.25 + Math.random() * 1.2) + reference * 0.00015;
      candles.push({ time, open, high: Math.max(open, close) + wick, low: Math.max(0.00000001, Math.min(open, close) - wick), close });
      previous = close;
    }
    return res.json({ pair, interval, source: 'market-reference', candles });
  } catch (e) {
    return res.status(503).json({ error: `Chart candles unavailable: ${e.message}` });
  }
});
router.get('/health', async (req, res) => { res.json({ exchange: await detectExchange(), execution: 'internal' }); });

// Indicative order book and recent trades derived from the reference price.
router.get('/book/:pair', auth, async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/');
    if (!isSupported(pair)) return res.status(400).json({ error: 'Unsupported pair' });
    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'No reference price available' });
    const bids = [], asks = [];
    for (let i = 0; i < 12; i++) {
      const bd = mid * (1 - 0.0006 * (i + 1) - Math.random() * 0.0004);
      const ad = mid * (1 + 0.0006 * (i + 1) + Math.random() * 0.0004);
      const bA = +(0.05 + Math.random() * 2).toFixed(4), aA = +(0.05 + Math.random() * 2).toFixed(4);
      bids.push({ price: +bd.toFixed(marketByPair.get(pair).decimals), amount: bA, total: +(bd*bA).toFixed(2) });
      asks.push({ price: +ad.toFixed(marketByPair.get(pair).decimals), amount: aA, total: +(ad*aA).toFixed(2) });
    }
    bids.sort((a,b) => b.price-a.price); asks.sort((a,b) => a.price-b.price);
    res.json({ pair, mid, bids, asks, updatedAt: new Date() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/trades/:pair', auth, async (req, res) => {
  try {
    const pair = req.params.pair.replace('-', '/');
    if (!isSupported(pair)) return res.status(400).json({ error: 'Unsupported pair' });
    const mid = await fetchLivePrice(pair);
    if (!mid) return res.status(400).json({ error: 'No reference price available' });
    const trades = Array.from({ length: 20 }, () => ({
      side: Math.random() > 0.5 ? 'buy' : 'sell',
      price: +(mid * (1 + (Math.random() - 0.5) * 0.004)).toFixed(marketByPair.get(pair).decimals),
      amount: +(0.001 + Math.random() * 0.5).toFixed(4),
      time: new Date(Date.now() - Math.floor(Math.random() * 300) * 1000)
    })).sort((a,b) => b.time-a.time);
    res.json(trades);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/my', auth, async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(orders);
});
router.get('/history', auth, async (req, res) => {
  try {
    const filter = { user: req.user._id, status: { $in: ['filled','cancelled'] } };
    if (req.query.pair && isSupported(req.query.pair)) filter.pair = req.query.pair;
    const rows = await Order.find(filter).sort({ updatedAt: -1, createdAt: -1 }).limit(200).lean();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/positions', auth, async (req, res) => {
  const positions = await Position.find({ user: req.user._id, amount: { $gt: 0 } }).lean();
  res.json(positions);
});

async function closePositionAtomic(positionId, userId, price, reason, performedBy = null) {
  return inTransaction(async session => {
    const pos = await Position.findOne({ _id: positionId, user: userId, amount: { $gt: 0 } }).session(session);
    if (!pos) return null;
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error('User not found');
    const [base, quote] = pos.pair.split('/');
    const amount = pos.amount;
    if ((user.balances[base] || 0) + 1e-8 < amount) throw new Error(`Insufficient ${base} balance to close position`);
    const proceeds = roundMoney(price * amount);
    const pnl = roundMoney(amount * (price - pos.avgCost));
    user.balances[base] = roundMoney((user.balances[base] || 0) - amount);
    user.balances[quote] = roundMoney((user.balances[quote] || 0) + proceeds);
    pos.realized = roundMoney((pos.realized || 0) + pnl);
    pos.amount = 0; pos.avgCost = 0; pos.stopLoss = 0; pos.takeProfit = 0; pos.updatedAt = new Date();
    await user.save({ session }); await pos.save({ session });
    const [baseAsset] = pos.pair.split('/');
    await Order.create([{
      user: userId, side: 'sell', pair: pos.pair, type: 'market', price,
      amount, filled: amount, avgFillPrice: price, status: 'filled',
      closeReason: reason
    }], { session, ordered: true });
    await Transaction.create([{
      user: userId, type: 'earn', category: 'trade_close', direction: 'credit', currency: quote, amount: proceeds,
      pair: pos.pair, side: 'sell', quantity: amount, price, referenceId: String(pos._id), status: 'completed',
      note: `${reason} close ${pos.pair}: sold ${amount} ${baseAsset} @ ${price}; realized PnL ${pnl} ${quote}`,
      performedBy
    }], { session, ordered: true });
    return { proceeds, pnl, pair: pos.pair, amount, base, quote };
  });
}

router.post('/positions/:id/close', auth, async (req, res) => {
  try {
    const pos = await Position.findOne({ _id: req.params.id, user: req.user._id, amount: { $gt: 0 } });
    if (!pos) return res.status(404).json({ error: 'Position not found' });
    const price = await fetchLivePrice(pos.pair);
    if (!finitePositive(price)) return res.status(400).json({ error: 'Price unavailable' });
    const result = await closePositionAtomic(pos._id, req.user._id, price, 'Manual');
    if (!result) return res.status(409).json({ error: 'Position was already closed' });
    await notify(req.user._id, 'system', 'Position closed', `Sold ${result.amount} ${result.base} @ ${price}; PnL ${result.pnl} ${result.quote}`).catch(() => {});
    res.json({ closed: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', auth, async (req, res) => {
  try {
    const { side, pair, type = 'limit' } = req.body;
    const amount = Number(req.body.amount), priceInput = Number(req.body.price);
    const sl = req.body.stopLoss === '' || req.body.stopLoss == null ? 0 : Number(req.body.stopLoss);
    const tp = req.body.takeProfit === '' || req.body.takeProfit == null ? 0 : Number(req.body.takeProfit);
    if (!['buy','sell'].includes(side)) return res.status(400).json({ error: 'Invalid side' });
    if (!isSupported(pair)) return res.status(400).json({ error: 'Unsupported trading pair' });
    const [tradingControl, pairControl] = await Promise.all([Settings.findOne({ key: 'trading' }).lean(), Settings.findOne({ key: 'tradingPairs' }).lean()]);
    if (tradingControl?.value?.enabled === false) return res.status(423).json({ error: tradingControl.value.message || 'New orders are temporarily unavailable. Please try again shortly.' });
    if (pairControl?.value?.[pair]?.enabled === false) return res.status(423).json({ error: `Trading on ${pair} is temporarily unavailable` });
    if (!['market','limit'].includes(type)) return res.status(400).json({ error: 'Invalid order type' });
    if (!finitePositive(amount) || amount > 1e9) return res.status(400).json({ error: 'Enter a valid amount' });
    if (sl < 0 || tp < 0 || !Number.isFinite(sl) || !Number.isFinite(tp)) return res.status(400).json({ error: 'Invalid stop-loss or take-profit price' });
    if (type === 'limit' && !finitePositive(priceInput)) return res.status(400).json({ error: 'Enter a valid limit price' });
    if (side === 'sell' && (sl > 0 || tp > 0)) return res.status(400).json({ error: 'Attach stop-loss and take-profit to buy orders/long positions only' });
    const marketPrice = await fetchLivePrice(pair);
    if (!finitePositive(marketPrice)) return res.status(400).json({ error: 'Reference price unavailable' });
    const limitPrice = type === 'limit' ? priceInput : marketPrice;
    const estimatedNotional = amount * limitPrice;
    if (!Number.isFinite(estimatedNotional) || estimatedNotional < 1 || estimatedNotional > 1000000) return res.status(400).json({ error: 'Order value must be between 1 and 1,000,000 USDT' });
    if (sl > 0 && sl >= limitPrice) return res.status(400).json({ error: 'Stop-loss must be below the entry price' });
    if (tp > 0 && tp <= limitPrice) return res.status(400).json({ error: 'Take-profit must be above the entry price' });
    const [base, quote] = pair.split('/');

    const created = await inTransaction(async session => {
      const user = await User.findById(req.user._id).session(session);
      if (!user) throw new Error('User not found');
      if (!user.balances) user.balances = {}; if (!user.locked) user.locked = {};
      const executionPrice = type === 'market' ? marketPrice : limitPrice;
      if (side === 'buy') {
        const reserve = roundMoney(limitPrice * amount);
        if ((user.balances[quote] || 0) + 1e-8 < reserve) throw new Error(`Insufficient available ${quote}`);
        if (type === 'limit') {
          user.balances[quote] = roundMoney((user.balances[quote] || 0) - reserve);
          user.locked[quote] = roundMoney((user.locked[quote] || 0) + reserve);
        } else {
          const cost = roundMoney(executionPrice * amount);
          user.balances[quote] = roundMoney((user.balances[quote] || 0) - cost);
          user.balances[base] = roundMoney((user.balances[base] || 0) + amount);
          await addToPosition(user._id, pair, amount, executionPrice, sl, tp, session);
        }
      } else {
        if ((user.balances[base] || 0) + 1e-8 < amount) throw new Error(`Insufficient available ${base}`);
        if (type === 'limit') {
          user.balances[base] = roundMoney((user.balances[base] || 0) - amount);
          user.locked[base] = roundMoney((user.locked[base] || 0) + amount);
        } else {
          user.balances[base] = roundMoney((user.balances[base] || 0) - amount);
          user.balances[quote] = roundMoney((user.balances[quote] || 0) + executionPrice * amount);
          const pos = await Position.findOne({ user: user._id, pair }).session(session);
          if (pos && pos.amount > 0) await addToPosition(user._id, pair, -Math.min(amount, pos.amount), executionPrice, 0, 0, session);
        }
      }
      await user.save({ session });
      const order = await Order.create([{
        user: user._id, side, pair, type, price: limitPrice, amount,
        filled: type === 'market' ? amount : 0,
        avgFillPrice: type === 'market' ? executionPrice : 0,
        status: type === 'market' ? 'filled' : 'open', stopLoss: sl, takeProfit: tp
      }], { session });
      if (type === 'market') await writeTradeTransaction({ userId: user._id, pair, side, amount, price: executionPrice, orderType: 'market', orderId: order[0]._id }, session);
      return order[0].toObject();
    });
    if (created.status === 'filled') await notify(req.user._id, 'system', 'Market order filled', `${side.toUpperCase()} ${amount} ${base} @ ${marketPrice} ${quote}`).catch(() => {});
    else await notify(req.user._id, 'system', 'Limit order placed', `${side.toUpperCase()} ${amount} ${base} @ ${limitPrice} ${quote}`).catch(() => {});
    res.json(created);
  } catch (e) {
    const status = /Insufficient|valid|Unsupported|Invalid|below|above|Attach/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const cancelled = await inTransaction(async session => {
      const order = await Order.findOne({ _id: req.params.id, user: req.user._id, status: { $in: ['open','partial'] } }).session(session);
      if (!order) return null;
      const user = await User.findById(req.user._id).session(session);
      if (!user) throw new Error('User not found');
      const remaining = roundMoney(order.amount - order.filled);
      const [base, quote] = order.pair.split('/');
      if (order.side === 'buy') {
        const refund = roundMoney(order.price * remaining);
        if ((user.locked[quote] || 0) + 1e-8 < refund) throw new Error('Locked quote balance is inconsistent');
        user.locked[quote] = roundMoney((user.locked[quote] || 0) - refund);
        user.balances[quote] = roundMoney((user.balances[quote] || 0) + refund);
      } else {
        if ((user.locked[base] || 0) + 1e-8 < remaining) throw new Error('Locked asset balance is inconsistent');
        user.locked[base] = roundMoney((user.locked[base] || 0) - remaining);
        user.balances[base] = roundMoney((user.balances[base] || 0) + remaining);
      }
      order.status = 'cancelled'; order.updatedAt = new Date();
      await user.save({ session }); await order.save({ session });
      return order.toObject();
    });
    if (!cancelled) return res.status(409).json({ error: 'Order not found or no longer cancellable' });
    await notify(req.user._id, 'system', 'Order cancelled', `${cancelled.side.toUpperCase()} ${cancelled.amount} ${cancelled.pair}`).catch(() => {});
    res.json(cancelled);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Persistent matcher: price condition is checked on every pass, not a one-shot timeout.
let matcherRunning = false;
async function matchOpenOrders() {
  if (matcherRunning) return;
  matcherRunning = true;
  try {
    const orders = await Order.find({ type: 'limit', status: { $in: ['open','partial'] } }).sort({ createdAt: 1 }).limit(250).lean();
    for (const order of orders) {
      const price = await fetchLivePrice(order.pair);
      if (!finitePositive(price)) continue;
      const eligible = order.side === 'buy' ? price <= order.price : price >= order.price;
      if (!eligible) continue;
      try {
        const result = await tryFillLimit(order._id, price);
        if (result) await notify(result.userId, 'system', 'Limit order filled', `${result.amount} ${result.order.pair} @ ${result.price}`).catch(() => {});
      } catch (e) { console.error('Limit fill failed:', e.message); }
    }
  } catch (e) { console.error('Limit matcher:', e.message); }
  finally { matcherRunning = false; }
}
const matcherTimer = setInterval(matchOpenOrders, 2000);
if (matcherTimer.unref) matcherTimer.unref();

module.exports = router;
module.exports.fetchLivePrice = fetchLivePrice;
module.exports.closePositionAtomic = closePositionAtomic;
