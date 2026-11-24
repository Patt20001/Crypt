const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();

// Public config: only the keys the public site needs. Admins (valid token) receive everything.
const PUBLIC_KEYS = ['banner', 'maintenance'];
router.get('/', async (req, res) => {
  let isAdmin = false;
  try {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
      const u = await User.findById(decoded.id).select('role tokenVersion isBanned');
      isAdmin = !!u && u.role === 'admin' && !u.isBanned && (decoded.v || 0) === (u.tokenVersion || 0);
    }
  } catch {}
  const list = await Settings.find(isAdmin ? {} : { key: { $in: PUBLIC_KEYS } });
  const obj = {};
  list.forEach(s => obj[s.key] = s.value);
  res.json(obj);
});

// Admin only: set config
router.post('/', auth, adminOnly, async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'Key required' });
  const s = await Settings.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
  res.json(s);
});

module.exports = router;