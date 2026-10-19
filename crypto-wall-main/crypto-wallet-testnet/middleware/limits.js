const Transaction = require('../models/Transaction');

const LIMITS = {
  unverified: 100,
  pending:    500,
  verified:   Infinity
};

async function checkWithdrawLimit(user, amount) {
  const limit = LIMITS[user.kycStatus] ?? 100;
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const txs = await Transaction.find({
    user: user._id,
    type: 'withdraw',
    status: { $in: ['pending', 'completed'] },
    createdAt: { $gte: since }
  });

  const used = txs.reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, limit - used);

  if (amount > remaining) {
    return {
      ok: false,
      limit,
      used,
      remaining,
      message: `Daily withdrawal limit for ${user.kycStatus} accounts is ${limit} USDT. You can withdraw up to ${remaining.toFixed(2)} USDT today.`
    };
  }
  return { ok: true, limit, used, remaining };
}

module.exports = { checkWithdrawLimit, LIMITS };