const Settings = require('../models/Settings');
const User = require('../models/User');
const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const Transaction = require('../models/Transaction');

const round = n => Number(Number(n || 0).toFixed(8));

/* Global platform fee overrides the per-trader value when it has been configured. */
async function getPlatformRate(trader, session) {
  const q = Settings.findOne({ key: 'copyPlatformFeePercent' }).lean();
  if (session) q.session(session);
  const setting = await q;
  const global = setting && Number.isFinite(Number(setting.value)) ? Number(setting.value) : null;
  return global == null ? Number(trader.platformFee || 0) : global;
}

/* Fees apply only to profit above the previous high-water mark. */
function calcFees(rel, trader, platformRate) {
  const newProfit = Math.max(0, Number(rel.pnl || 0) - Number(rel.highWaterMark || 0));
  const traderFee = round(newProfit * Number(trader.performanceFee || 0) / 100);
  const platformFee = round(newProfit * Number(platformRate || 0) / 100);
  return { newProfit, traderFee, platformFee, total: round(traderFee + platformFee) };
}

/* Books a fee: pays the trader, updates counters and the high-water mark, writes the ledger entry.
   The caller is responsible for taking the fee from the follower (balance or payout). */
async function recordFees({ session, rel, trader, fees }) {
  if (trader.user && fees.traderFee > 0) {
    await User.updateOne({ _id: trader.user }, { $inc: { 'balances.USDT': fees.traderFee } }, { session });
  }
  await CopyTrader.updateOne({ _id: trader._id }, { $inc: { totalEarned: fees.traderFee } }, { session });
  await CopyRelation.updateOne({ _id: rel._id }, {
    $inc: { traderFees: fees.traderFee, platformFees: fees.platformFee },
    $set: { highWaterMark: Number(rel.pnl || 0), lastFeeSettledAt: new Date() }
  }, { session });
  await Transaction.create([{
    user: rel.follower, type: 'earn', category: 'copy_fee', currency: 'USDT', amount: -fees.total, status: 'completed',
    referenceId: String(rel._id),
    note: `Copy performance fee: ${fees.traderFee.toFixed(4)} to trader, ${fees.platformFee.toFixed(4)} to platform`
  }], { session });
}

module.exports = { round, getPlatformRate, calcFees, recordFees };
