const express = require('express');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { checkWithdrawLimit } = require('../middleware/limits');
const { notify } = require('../middleware/notify');
const router = express.Router();

/* Generate a realistic-looking deposit address per network */
function generateAddress(network) {
  const rand = (len, alphabet) => {
    let s = '';
    const bytes = crypto.randomBytes(len);
    for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length];
    return s;
  };

  switch (network) {
    case 'TRC20': return 'T' + rand(33, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789');
    case 'ERC20':
    case 'BEP20': return '0x' + rand(40, '0123456789abcdef');
    case 'SOL':   return rand(44, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789');
    case 'BTC':   return 'bc1q' + rand(38, 'abcdefghijklmnopqrstuvwxyz0123456789');
    case 'XRP':   return 'r' + rand(33, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789');
    case 'ADA':   return 'addr1' + rand(58, 'abcdefghijkmnopqrstuvwxyz0123456789');
    case 'DOGE':  return 'D' + rand(33, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789');
    default:      return '0x' + rand(40, '0123456789abcdef');
  }
}

/* Ensure the user has a deposit address for the given network */
function ensureAddress(user, network) {
  if (!user.depositAddresses) user.depositAddresses = {};
  if (!user.depositAddresses[network]) {
    user.depositAddresses[network] = generateAddress(network);
  }
  return user.depositAddresses[network];
}

/* GET balance + all deposit addresses */
router.get('/balance', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  const NETWORKS = ['TRC20', 'ERC20', 'BEP20', 'SOL', 'BTC', 'XRP', 'ADA', 'DOGE'];

  // Ensure all addresses exist
  let changed = false;
  NETWORKS.forEach(n => {
    if (!user.depositAddresses[n]) {
      user.depositAddresses[n] = generateAddress(n);
      changed = true;
    }
  });
  if (changed) await user.save();

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
  const since = new Date();
  since.setHours(0, 0, 0, 0);
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

/* Deposit — user does NOT specify amount, just currency + network */
router.post('/deposit', auth, async (req, res) => {
  const { currency = 'USDT', network = 'TRC20', note = '' } = req.body;

  const requiredConfs = {
    TRC20: 19, ERC20: 12, BEP20: 15, SOL: 1,
    BTC: 3, XRP: 1, ADA: 15, DOGE: 6
  }[network] || 19;

  const user = await User.findById(req.user._id);
  ensureAddress(user, network);
  await user.save();

  const tx = await Transaction.create({
    user: req.user._id,
    type: 'deposit',
    currency,
    amount: 0,
    status: 'pending',
    confirmations: 0,
    requiredConfirmations: requiredConfs,
    network,
    note: `Deposit ${currency} via ${network}${note ? ' · ' + note : ''}`,
    address: user.depositAddresses[network]
  });
  res.json(tx);
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

    // USDT-only limit check for simplicity
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