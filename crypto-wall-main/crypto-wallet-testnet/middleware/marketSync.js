const Position = require('../models/Position');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { notify } = require('./notify');

const priceCache = {};

async function fetchPrice(pair) {
  const symbol = pair.replace('/', '').toUpperCase();
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      return parseFloat(j.price);
    }
  } catch {}
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`,
      { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const j = await res.json();
      return parseFloat(j.result?.list?.[0]?.lastPrice);
    }
  } catch {}
  return null;
}

async function closePosition(pos, price, reason) {
  const user = await User.findById(pos.user);
  if (!user) return;

  const [base, quote] = pos.pair.split('/');
  const proceeds = price * pos.amount;
  user.balances[base] = Math.max(0, (user.balances[base] || 0) - pos.amount);
  user.balances[quote] = (user.balances[quote] || 0) + proceeds;
  await user.save();

  const pnl = pos.amount * (price - pos.avgCost);
  pos.realized += pnl;
  pos.amount = 0;
  pos.avgCost = 0;
  pos.stopLoss = 0;
  pos.takeProfit = 0;
  pos.updatedAt = new Date();
  await pos.save();

  await Transaction.create({
    user: user._id, type: 'earn',
    currency: quote, amount: proceeds, status: 'completed',
    note: `${reason} on ${pos.pair} @ ${price.toFixed(2)} · PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`
  });

  await notify(user._id, 'system', `${reason} triggered`,
    `Closed ${pos.pair} @ ${price.toFixed(2)} · PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
}

async function scanPositions() {
  try {
    const positions = await Position.find({ amount: { $gt: 0 } });
    if (!positions.length) return;

    const pairs = [...new Set(positions.map(p => p.pair))];
    for (const pair of pairs) {
      const price = await fetchPrice(pair);
      if (!price) continue;
      priceCache[pair] = price;

      const activePositions = positions.filter(p => p.pair === pair);

      for (const pos of activePositions) {
        if (pos.takeProfit > 0 && price >= pos.takeProfit) {
          await closePosition(pos, price, 'Take-Profit');
        } else if (pos.stopLoss > 0 && price <= pos.stopLoss) {
          await closePosition(pos, price, 'Stop-Loss');
        }
      }
    }
  } catch (e) {
    console.error('scanPositions error:', e.message);
  }
}

let intervalHandle = null;

function start() {
  if (intervalHandle) return;
  console.log('📊 Position SL/TP scanner started');
  intervalHandle = setInterval(scanPositions, 10_000);
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { start, stop, priceCache, fetchPrice };