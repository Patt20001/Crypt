const express = require('express');
const Settings = require('../models/Settings');
const { auth, adminOnly } = require('../middleware/auth');
const router = express.Router();

// Public config
router.get('/', async (req, res) => {
  const list = await Settings.find();
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