const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { checkWithdrawLimit } = require('../middleware/limits');
const { notify } = require('../middleware/notify');
const { verifyTOTP } = require('../utils/totp');

const router = express.Router();

/* ============================================================
   BALANCE
   ============================================================ */
router.get('/balance', auth, async (req, res) => {
  const user = await User.findById(req.user._id).select('balances locked walletAddress');
  res.json(user);
});

/* ============================================================
   DAILY LIMITS
   ============================================================ */
router.get('/limits', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  const { LIMITS } = require('../middleware/limits');
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
  res.json({
    kycStatus: user.kycStatus,
    limit: limit === Infinity ? null : limit,
    used,
    remaining: limit === Infinity ? null : Math.max(0, limit - used)
  });
});

/* ============================================================
   TRANSACTIONS
   ============================================================ */
router.get('/transactions', auth, async (req, res) => {
  const txs = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(txs);
});

router.get('/transactions/:id', auth, async (req, res) => {
  const tx = await Transaction.findOne({ _id: req.params.id, user: req.user._id });
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

/* ============================================================
   DEPOSIT REQUEST
   Amount is entered by admin on approval — user just signals intent.
   ============================================================ */
router.post('/deposit', auth, async (req, res) => {
  const { currency = 'USDT', network = 'TRC20', note = '' } = req.body;
  const requiredConfs = { TRC20: 19, ERC20: 12, BEP20: 15, SOL: 1 }[network] || 19;

  const tx = await Transaction.create({
    user: req.user._id,
    type: 'deposit',
    currency,
    amount: 0,
    status: 'pending',
    confirmations: 0,
    requiredConfirmations: requiredConfs,
    network,
    note: `Deposit via ${network}${note ? ' · ' + note : ''}`
  });
  res.json(tx);
});

/* ============================================================
   WITHDRAW REQUEST
   ============================================================ */
router.post('/withdraw', auth, async (req, res) => {
  try {
    const { amount, currency = 'USDT', address = '', note = '', code } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ error: 'Invalid amount' });

    const user = await User.findById(req.user._id);

    // ---------- 2FA gate ----------
    if (user.twoFA) {
      if (!code) return res.status(400).json({ error: '2FA code required' });

      const cleanCode = String(code).replace(/\s/g, '');
      const isTotp = verifyTOTP(cleanCode, user.twoFASecret);
      const isRecovery = (user.twoFARecoveryCodes || []).includes(cleanCode.toUpperCase());

      if (!isTotp && !isRecovery)
        return res.status(400).json({ error: 'Invalid 2FA code' });

      if (isRecovery) {
        user.twoFARecoveryCodes = user.twoFARecoveryCodes.filter(
          c => c !== cleanCode.toUpperCase()
        );
      }
    }

    // ---------- balance ----------
    if (user.balances[currency] < amount)
      return res.status(400).json({ error: 'Insufficient balance' });

    // ---------- daily limit ----------
    const check = await checkWithdrawLimit(user, amount);
    if (!check.ok) return res.status(400).json({ error: check.message });

    // ---------- lock funds ----------
    user.balances[currency] -= amount;
    user.locked[currency] = (user.locked[currency] || 0) + amount;
    await user.save();

    const tx = await Transaction.create({
      user: user._id,
      type: 'withdraw',
      currency,
      amount,
      address,
      note,
      status: 'pending'
    });

    await notify(
      user._id,
      'withdraw',
      'Withdrawal requested',
      `${amount} ${currency} to ${address.slice(0, 10)}… is being processed.`
    );

    res.json(tx);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;