const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { notify } = require('./notify');

/* ============================================================
   Trader ROI drift every 60s
   ============================================================ */
async function syncTraders() {
  try {
    const traders = await CopyTrader.find({ active: true });
    if (!traders.length) return;

    for (const t of traders) {
      const bias = {
        diamond: 0.03,
        gold:    0.015,
        silver:  0.0,
        bronze: -0.02
      }[t.tier] || 0;

      const noise = (Math.random() - 0.5) * 0.3;
      const delta = bias + noise;

      t.roi30d = +(Math.max(-50, Math.min(150, t.roi30d + delta))).toFixed(2);

      const targetWinRate = { diamond: 72, gold: 63, silver: 55, bronze: 47 }[t.tier] || 50;
      t.winRate = +(t.winRate + (targetWinRate - t.winRate) * 0.01 + (Math.random() - 0.5) * 0.2).toFixed(2);
      t.winRate = Math.max(20, Math.min(95, t.winRate));

      if (Math.random() > 0.7) t.totalTrades += 1;
      if (Math.random() > 0.9) t.followers += 1;

      await t.save();
    }

    // Reconcile follower counts with real relations
    const relations = await CopyRelation.find({ active: true });
    const realFollowers = {};
    relations.forEach(r => {
      const id = r.trader.toString();
      realFollowers[id] = (realFollowers[id] || 0) + 1;
    });
    for (const t of traders) {
      const real = realFollowers[t._id.toString()] || 0;
      const synthetic = Math.max(t.followers - real, 10);
      t.followers = synthetic + real;
      await t.save();
    }
  } catch (e) {
    console.error('traderSync error:', e.message);
  }
}

/* ============================================================
   Profit-sharing fee settlement (hourly)
   Uses high-water mark — fee only charged on NEW profit above previous peak
   ============================================================ */
async function settleFees() {
  try {
    const relations = await CopyRelation.find({ active: true, pnl: { $gt: 0 } })
      .populate('trader');

    for (const rel of relations) {
      if (!rel.trader) continue;
      if (rel.pnl <= rel.highWaterMark) continue;

      const newProfit = rel.pnl - rel.highWaterMark;
      const traderFee = newProfit * (rel.trader.performanceFee / 100);
      const platformFee = newProfit * (rel.trader.platformFee / 100);

      const follower = await User.findById(rel.follower);
      if (!follower) continue;

      follower.balances.USDT = Math.max(0, follower.balances.USDT - traderFee - platformFee);
      await follower.save();

      if (rel.trader.user) {
        const traderUser = await User.findById(rel.trader.user);
        if (traderUser) {
          traderUser.balances.USDT += traderFee;
          await traderUser.save();
          await notify(traderUser._id, 'system', 'Performance fee earned',
            `${traderFee.toFixed(4)} USDT from ${follower.username}'s copy of your trades`);
        }
      }

      rel.trader.totalEarned = (rel.trader.totalEarned || 0) + traderFee;
      await rel.trader.save();

      rel.traderFees = (rel.traderFees || 0) + traderFee;
      rel.platformFees = (rel.platformFees || 0) + platformFee;
      rel.highWaterMark = rel.pnl;
      rel.lastFeeSettledAt = new Date();
      await rel.save();

      await Transaction.create({
        user: follower._id,
        type: 'earn',
        currency: 'USDT',
        amount: -(traderFee + platformFee),
        status: 'completed',
        note: `Performance fee: ${traderFee.toFixed(4)} to ${rel.trader.displayName}, ${platformFee.toFixed(4)} to platform`
      });

      await notify(follower._id, 'system', 'Performance fee charged',
        `${(traderFee + platformFee).toFixed(4)} USDT from profit on ${rel.trader.displayName}`);
    }
  } catch (e) {
    console.error('settleFees error:', e.message);
  }
}

let intervalHandle = null;
let feeInterval = null;

function start() {
  if (intervalHandle) return;
  console.log('📈 Trader ROI sync started');
  intervalHandle = setInterval(syncTraders, 60_000);
  feeInterval = setInterval(settleFees, 60 * 60 * 1000);
}

function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  if (feeInterval) { clearInterval(feeInterval); feeInterval = null; }
}

module.exports = { start, stop, syncTraders, settleFees };