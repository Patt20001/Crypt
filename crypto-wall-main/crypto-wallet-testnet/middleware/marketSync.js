const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { notify } = require('./notify');

/* In-memory cache of prices, refreshed every cycle */
const priceCache = {};

async function fetchPrice(pair) {
  const symbol = pair.replace('/', '').toUpperCase();
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const j = await res.json();
      return parseFloat(j.price);
    }
  } catch {}
  // Bybit fallback
  try {
    const res = await fetch(
      `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const j = await res.json();
      return parseFloat(j.result?.list?.[0]?.lastPrice);
    }
  } catch {}
  return null;
}

/* Fire a stop-loss or take-profit order */
async function fireConditionalOrder(order, currentPrice) {
  try {
    const user = await User.findById(order.user);
    if (!user) return;

    const [base, quote] = order.pair.split('/');
    const triggerPrice = currentPrice;

    // Fill the order at current market price (not the trigger price)
    const cost = triggerPrice * order.amount;
    const refund = order.price * order.amount;    // locked at original price

    if (order.side === 'buy') {
      // Buy order SL/TP - release locked quote, add base
      user.locked[quote] = Math.max(0, (user.locked[quote] || 0) - refund);
      user.balances[base] = (user.balances[base] || 0) + order.amount;
    } else {
      // Sell order SL/TP - release locked base, add quote
      user.locked[base] = Math.max(0, (user.locked[base] || 0) - order.amount);
      user.balances[quote] = (user.balances[quote] || 0) + cost;
    }
    await user.save();

    order.status = 'filled';
    order.filled = order.amount;
    order.updatedAt = new Date();
    order.triggerPrice = triggerPrice;
    await order.save();

    await Transaction.create({
      user: user._id,
      type: 'earn',
      currency: order.side === 'buy' ? base : quote,
      amount: order.side === 'buy' ? order.amount : cost,
      status: 'completed',
      note: `${order.conditionalType.toUpperCase()} triggered at ${triggerPrice} · ${order.side.toUpperCase()} ${order.amount} ${base}`
    });

    await notify(
      user._id, 'system',
      `${order.conditionalType === 'stop_loss' ? 'Stop-Loss' : 'Take-Profit'} triggered`,
      `${order.side.toUpperCase()} ${order.amount} ${base} @ ${triggerPrice.toFixed(2)} ${quote}`
    );

    console.log(`✅ ${order.conditionalType} fired for ${order.pair} at ${triggerPrice}`);
  } catch (e) {
    console.error('fireConditionalOrder error:', e.message);
  }
}

/* Main loop */
async function scanConditionals() {
  try {
    const pending = await Order.find({
      status: 'open',
      conditionalType: { $in: ['stop_loss', 'take_profit'] }
    });

    if (!pending.length) return;

    // Group by pair to avoid fetching the same price twice
    const pairs = [...new Set(pending.map(o => o.pair))];

    for (const pair of pairs) {
      const price = await fetchPrice(pair);
      if (!price) continue;
      priceCache[pair] = price;

      const toFire = pending.filter(o => o.pair === pair && (
        // Stop-loss on a sell order: price drops below trigger
        (o.conditionalType === 'stop_loss' && o.side === 'sell' && price <= o.triggerPrice) ||
        // Stop-loss on a buy order: price rises above trigger (buying to cover short)
        (o.conditionalType === 'stop_loss' && o.side === 'buy' && price >= o.triggerPrice) ||
        // Take-profit on a sell: price rises above trigger
        (o.conditionalType === 'take_profit' && o.side === 'sell' && price >= o.triggerPrice) ||
        // Take-profit on a buy: price drops below trigger
        (o.conditionalType === 'take_profit' && o.side === 'buy' && price <= o.triggerPrice)
      ));

      for (const order of toFire) {
        await fireConditionalOrder(order, price);
      }
    }
  } catch (e) {
    console.error('scanConditionals error:', e.message);
  }
}

let intervalHandle = null;

function start() {
  if (intervalHandle) return;
  console.log('📊 Conditional order scanner started');
  intervalHandle = setInterval(scanConditionals, 10_000);   // every 10s
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { start, stop, priceCache, fetchPrice };