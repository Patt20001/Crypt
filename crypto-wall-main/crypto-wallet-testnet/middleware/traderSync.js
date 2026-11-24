const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const mongoose = require('mongoose');
const { getPlatformRate, calcFees, recordFees } = require('../utils/copyFees');
const { notify } = require('./notify');

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const round = n => Number(Number(n || 0).toFixed(4));

function makeHistory(roi, days = 180) {
  const out = [];
  let value = Number(roi || 0);
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(12, 0, 0, 0);
    if (i > 0) value = clamp(value + (Math.random() - 0.53) * 1.15, -80, 250);
    else value = Number(roi || 0);
    out.push({ date: d, roi30d: round(value) });
  }
  return out;
}

/* Trader performance profiles are refreshed gradually and daily history snapshots are stored. */
async function syncTraders() {
  try {
    const traders = await CopyTrader.find({ active: true });
    if (!traders.length) return;

    for (const t of traders) {
      const previousRoi = Number(t.roi30d || 0);
      const bias = { diamond: 0.018, gold: 0.009, silver: 0.001, bronze: -0.006 }[t.tier] || 0;
      const delta = bias + (Math.random() - 0.5) * 0.12;
      t.roi30d = round(clamp(previousRoi + delta, -60, 180));
      const targetWin = { diamond: 72, gold: 63, silver: 55, bronze: 47 }[t.tier] || 50;
      t.winRate = round(clamp(Number(t.winRate || targetWin) + (targetWin - Number(t.winRate || targetWin)) * 0.004 + (Math.random() - 0.5) * 0.06, 20, 95));
      if (Math.random() > 0.985) t.totalTrades += 1;
      if (Math.random() > 0.992) t.followers += 1;

      if (!t.performanceHistory || !t.performanceHistory.length) t.performanceHistory = makeHistory(previousRoi);
      const today = new Date(); today.setHours(12, 0, 0, 0);
      const last = t.performanceHistory[t.performanceHistory.length - 1];
      if (last && new Date(last.date).toDateString() === today.toDateString()) {
        last.roi30d = t.roi30d;
      } else {
        t.performanceHistory.push({ date: today, roi30d: t.roi30d });
      }
      if (t.performanceHistory.length > 180) t.performanceHistory = t.performanceHistory.slice(-180);
      await t.save();

      // Followers' unrealized PnL follows the trader's change in ROI, based on their allocation.
      const relations = await CopyRelation.find({ trader: t._id, active: true });
      for (const rel of relations) {
        const baseline = rel.lastTraderRoi == null ? previousRoi : Number(rel.lastTraderRoi);
        const roiDelta = t.roi30d - baseline;
        const pnlDelta = round(Number(rel.allocation || 0) * roiDelta / 100);
        // Atomic and limited to active copies so a copy stopped mid-run is never modified afterwards.
        await CopyRelation.updateOne({ _id: rel._id, active: true },
          { $inc: { pnl: pnlDelta }, $set: { lastTraderRoi: t.roi30d } });
      }
    }

    // Followers are the count of active platform relations plus the trader's seeded audience.
    const relations = await CopyRelation.aggregate([{ $match: { active: true } }, { $group: { _id: '$trader', count: { $sum: 1 } } }]);
    const counts = new Map(relations.map(x => [String(x._id), x.count]));
    for (const t of traders) {
      const real = counts.get(String(t._id)) || 0;
      if (Number(t.followers || 0) < real) { t.followers = real; await t.save(); }
    }
  } catch (e) { console.error('traderSync error:', e.message); }
}

/* Profit-sharing settlement. Each relation is settled in its own transaction so an hourly run
   can never double-charge a fee that was already taken when a copy was stopped. */
async function settleFees() {
  try {
    const candidates = await CopyRelation.find({ active: true, pnl: { $gt: 0 } }).select('_id').lean();
    for (const c of candidates) {
      const session = await mongoose.startSession();
      let notice = null;
      try {
        await session.withTransaction(async () => {
          notice = null;
          const rel = await CopyRelation.findOne({ _id: c._id, active: true }).session(session);
          if (!rel || Number(rel.pnl) <= Number(rel.highWaterMark || 0)) return;
          const trader = await CopyTrader.findById(rel.trader).session(session);
          if (!trader) return;
          const fees = calcFees(rel, trader, await getPlatformRate(trader, session));
          if (fees.total <= 0) return;
          const charged = await User.updateOne(
            { _id: rel.follower, 'balances.USDT': { $gte: fees.total } },
            { $inc: { 'balances.USDT': -fees.total } }, { session });
          if (!charged.modifiedCount) return; // insufficient balance: retry on the next run
          await recordFees({ session, rel, trader, fees });
          notice = { user: rel.follower, total: fees.total, name: trader.displayName };
        });
      } catch (e) { console.error('settleFees error:', e.message); }
      finally { await session.endSession(); }
      if (notice) await notify(notice.user, 'system', 'Performance fee charged',
        `${notice.total.toFixed(4)} USDT on profit from ${notice.name}`).catch(() => {});
    }
  } catch (e) { console.error('settleFees error:', e.message); }
}

let intervalHandle = null;
let feeInterval = null;
function start() {
  if (intervalHandle) return;
  console.log('📈 Trader ROI sync started');
  syncTraders();
  intervalHandle = setInterval(syncTraders, 60_000);
  feeInterval = setInterval(settleFees, 60 * 60 * 1000);
}
function stop() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  if (feeInterval) { clearInterval(feeInterval); feeInterval = null; }
}
module.exports = { start, stop, syncTraders, settleFees };
