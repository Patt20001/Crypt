const mongoose = require('mongoose');
const Position = require('../models/Position');
const User = require('../models/User');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { notify } = require('./notify');

const priceCache = Object.create(null);
const PRICE_TTL = 2500;
const supportedBases = ['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','LTC','TRX','DOT','AVAX','LINK','BCH','TON','NEAR','ATOM','UNI'];

async function fetchPrice(pair) {
  if (priceCache[pair] && Date.now() - priceCache[pair].at < PRICE_TTL) return priceCache[pair].price;
  const symbol = pair.replace('/', '').toUpperCase();
  for (const url of [
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
    `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`
  ]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const json = await res.json();
      const price = Number(json.price || json.result?.list?.[0]?.lastPrice);
      if (Number.isFinite(price) && price > 0) {
        priceCache[pair] = { price, at: Date.now() };
        return price;
      }
    } catch {}
  }
  return priceCache[pair]?.price || null;
}

async function closePosition(positionId, price, reason) {
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      // Re-read inside transaction. This prevents manual close and scanner from
      // both crediting the same position when they race.
      const pos = await Position.findOne({ _id: positionId, amount: { $gt: 0 } }).session(session);
      if (!pos) return;
      const user = await User.findById(pos.user).session(session);
      if (!user) return;
      const [base, quote] = pos.pair.split('/');
      const amount = pos.amount;
      if ((user.balances[base] || 0) + 1e-8 < amount) throw new Error(`Insufficient ${base} balance for protective close`);
      const proceeds = Math.round(price * amount * 1e8) / 1e8;
      const pnl = Math.round(amount * (price - pos.avgCost) * 1e8) / 1e8;
      user.balances[base] = Math.round(((user.balances[base] || 0) - amount) * 1e8) / 1e8;
      user.balances[quote] = Math.round(((user.balances[quote] || 0) + proceeds) * 1e8) / 1e8;
      pos.realized = Math.round(((pos.realized || 0) + pnl) * 1e8) / 1e8;
      pos.amount = 0; pos.avgCost = 0; pos.stopLoss = 0; pos.takeProfit = 0; pos.updatedAt = new Date();
      await user.save({ session });
      await pos.save({ session });
      await Order.create([{
        user: user._id, side: 'sell', pair: pos.pair, type: 'market', price,
        amount, filled: amount, avgFillPrice: price, status: 'filled', closeReason: reason
      }], { session });
      await Transaction.create([{
        user: user._id, type: 'earn', category: 'trade_close', direction: 'credit', currency: quote, amount: proceeds,
        pair: pos.pair, side: 'sell', quantity: amount, price, referenceId: String(pos._id), status: 'completed',
        note: `${reason} triggered: sold ${amount} ${base} @ ${price}; realized PnL ${pnl} ${quote}`
      }], { session });
      result = { userId: String(user._id), pair: pos.pair, amount, base, quote, pnl };
    });
  } finally { await session.endSession(); }
  if (result) {
    await notify(result.userId, 'system', `${reason} triggered`, `Closed ${result.pair} at ${price}; realized PnL ${result.pnl} ${result.quote}`).catch(() => {});
  }
  return result;
}

let scanning = false;
async function scanPositions() {
  if (scanning || mongoose.connection.readyState !== 1) return;
  scanning = true;
  try {
    const positions = await Position.find({ amount: { $gt: 0 }, $or: [
      { stopLoss: { $gt: 0 } }, { takeProfit: { $gt: 0 } }
    ] }).lean();
    const pairs = [...new Set(positions.map(p => p.pair))];
    for (const pair of pairs) {
      if (!supportedBases.includes(pair.split('/')[0])) continue;
      const price = await fetchPrice(pair);
      if (!price) continue;
      for (const pos of positions.filter(p => p.pair === pair)) {
        // This app is spot/long-only. For long positions, SL triggers below
        // the stop and TP triggers above the target.
        let reason = '';
        if (pos.stopLoss > 0 && price <= pos.stopLoss) reason = 'Stop-Loss';
        else if (pos.takeProfit > 0 && price >= pos.takeProfit) reason = 'Take-Profit';
        if (reason) {
          try { await closePosition(pos._id, price, reason); }
          catch (e) { console.error(`${reason} close failed for ${pair}:`, e.message); }
        }
      }
    }
  } catch (e) { console.error('scanPositions error:', e.message); }
  finally { scanning = false; }
}

let intervalHandle = null;
function start() {
  if (intervalHandle) return;
  console.log('📊 Internal spot position SL/TP scanner started');
  scanPositions();
  intervalHandle = setInterval(scanPositions, 5000);
}
function stop() { if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; } }
module.exports = { start, stop, priceCache, fetchPrice, scanPositions };
