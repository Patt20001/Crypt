const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

// Update profile fields
router.put('/update', auth, async (req, res) => {
  const { displayName, country, twoFA, kycStatus } = req.body;
  const user = await User.findById(req.user._id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (displayName !== undefined) user.displayName = displayName;
  if (country !== undefined)     user.country = country;
  if (twoFA !== undefined)       user.twoFA = !!twoFA;
  if (kycStatus !== undefined)   user.kycStatus = kycStatus;

  await user.save();
  const safe = await User.findById(user._id).select('-password');
  res.json(safe);
});

// Change password
router.put('/password', auth, async (req, res) => {
  const { current, next } = req.body;
  if (!current || !next) return res.status(400).json({ error: 'Both passwords required' });
  if (next.length < 6) return res.status(400).json({ error: 'New password min 6 chars' });

  const user = await User.findById(req.user._id);
  const ok = await bcrypt.compare(current, user.password);
  if (!ok) return res.status(401).json({ error: 'Current password incorrect' });

  user.password = await bcrypt.hash(next, 10);
  await user.save();
  res.json({ ok: true });
});

// Rotate wallet address
router.post('/rotate-address', auth, async (req, res) => {
  const user = await User.findById(req.user._id);
  user.walletAddress = 'T' + Math.random().toString(36).slice(2, 36).toUpperCase();
  await user.save();
  res.json({ walletAddress: user.walletAddress });
});

module.exports = router;