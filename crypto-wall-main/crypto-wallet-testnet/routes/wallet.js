const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { checkWithdrawLimit } = require('../middleware/limits');
const { notify } = require('../middleware/notify');
const { deriveAddress } = require('../utils/hdwallet');
const router = express.Router();

const SUPPORTED_NETWORKS = ['TRC20', 'ERC20', 'BEP20'];

/* Assign the next available address index, then derive addresses */
async function ensureAllAddresses(user) {
  if (user.depositAddressIndex == null) {
    const lastUser = await User.findOne({ depositAddressIndex: { $ne: null } })
      .sort({ depositAddressIndex: -1 });
    user.depositAddressIndex = (lastUser?.depositAddressIndex ?? -1) + 1;
  }

  if (!user.depositAddresses) user.depositAddresses = {};
  for (const network of SUPPORTED_NETWORKS) {
    if (!user.depositAddresses[network]) {
      try {
        user.depositAddresses[network] = deriveAddress(network, user.depositAddressIndex);
      } catch (e) {
        console.warn(`Could not derive ${network} address for ${user.username}:`, e.message);
      }
    }
  }
  await user.save();
  return user;
}

/* GET balance + all deposit addresses */
router.get('/balance', auth, async (req, res) => {
  let user = await User.findById(req.user._id);
  user = await ensureAllAddresses(user);
  res.json({
    balances: user.balances,
    locked: user.locked,
    depositAddresses: user.depositAddresses
  });
});

/* GET limits */
router.get('/limits', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  const { LIMITS } = require('../middleware/limits');
  const limit = LIMITS[user.kycStatus] ?? 100;
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const txs = await Transaction.find({
    user: user._id, type: 'withdraw',
    status: { $in: ['pending', 'completed'] },
    createdAt: { $gte: since }
  });
  const used = txs.reduce((s, t) => s + t.amount, 0);
  res.json({
    kycStatus: user.kycStatus,
    limit: limit === Infinity ? null : limit,
    used,
    remaining: limit === Infinity ? null : Math.max(0, limit - used)
  });
});

router.get('/transactions', auth, async (req, res) => {
  const txs = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(txs);
});

router.get('/transactions/:id', auth, async (req, res) => {
  const tx = await Transaction.findOne({ _id: req.params.id, user: req.user._id });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

/* Deposits are now created by the blockchain watcher — not users */
router.post('/deposit', auth, async (req, res) => {
  return res.status(410).json({
    error: 'Deposits are detected automatically. Send funds to your deposit address — no action needed.'
  });
});

/* Withdraw — user specifies amount + address + currency */
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, currency = 'USDT', address = '', note = '', code } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    if (!address || address.length < 10) return res.status(400).json({ error: 'Invalid address' });

    const user = await User.findById(req.user._id);

    if (user.twoFA) {
      if (!code) return res.status(400).json({ error: '2FA code required' });
      const { verifyTOTP } = require('../utils/totp');
      const cleanCode = String(code).replace(/\s/g, '');
      const isTotp = verifyTOTP(cleanCode, user.twoFASecret);
      const isRecovery = (user.twoFARecoveryCodes || []).includes(cleanCode.toUpperCase());
      if (!isTotp && !isRecovery)
        return res.status(400).json({ error: 'Invalid 2FA code' });
    }

    if ((user.balances[currency] || 0) < amount)
      return res.status(400).json({ error: `Insufficient ${currency} balance` });

    if (currency === 'USDT') {
      const check = await checkWithdrawLimit(user, amount);
      if (!check.ok) return res.status(400).json({ error: check.message });
    }

    user.balances[currency] -= amount;
    user.locked[currency] = (user.locked[currency] || 0) + amount;
    await user.save();

    const tx = await Transaction.create({
      user: user._id, type: 'withdraw', currency, amount, address, note, status: 'pending'
    });

    await notify(user._id, 'withdraw', 'Withdrawal requested',
      `${amount} ${currency} to ${address.slice(0, 10)}… is being processed.`);

    res.json(tx);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;