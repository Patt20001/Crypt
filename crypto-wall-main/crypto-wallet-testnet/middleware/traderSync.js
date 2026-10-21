const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');

/* Nudge all copy traders' stats every 60 seconds */
async function syncTraders() {
  try {
    const traders = await CopyTrader.find({ active: true });
    if (!traders.length) return;

    // ---- 1. Update ROI / win rate / trade count ----
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

      await t.save();
    }

    // ---- 2. Reconcile followers from real CopyRelation docs ----
    const relations = await CopyRelation.find({ active: true });
    const realFollowers = {};
    relations.forEach(r => {
      const id = r.trader.toString();
      realFollowers[id] = (realFollowers[id] || 0) + 1;
    });

    for (const t of traders) {
      const real = realFollowers[t._id.toString()] || 0;
      // Keep a synthetic base so follower count doesn't look empty for new traders
      const synthetic = Math.max(t.followers - real, 10);
      t.followers = synthetic + real;
      await t.save();
    }

    // ---- 3. Sync PnL on active relations (paper gain from trader's ROI) ----
    for (const r of relations) {
      const trader = traders.find(t => t._id.toString() === r.trader.toString());
      if (!trader) continue;

      // Follower gains a fraction of trader's ROI (weighted by their allocation)
      const dailyReturn = trader.roi30d / 30 / 100;
      const gain = r.allocation * dailyReturn * 0.5;  // 50% of trader's return
      r.pnl = +((r.pnl || 0) + gain).toFixed(4);
      await r.save();
    }
  } catch (e) {
    console.error('traderSync error:', e.message);
  }
}

let intervalHandle = null;

function start() {
  if (intervalHandle) return;
  console.log('📈 Trader ROI sync started');
  intervalHandle = setInterval(syncTraders, 60_000);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { start, stop, syncTraders };