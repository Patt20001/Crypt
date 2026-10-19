const express = require('express');
const Address = require('../models/Address');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.get('/', auth, async (req, res) => {
  const list = await Address.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json(list);
});

router.post('/', auth, async (req, res) => {
  const { label, address, network = 'TRC20' } = req.body;
  if (!label || !address) return res.status(400).json({ error: 'Label and address required' });
  try {
    const a = await Address.create({ user: req.user._id, label, address, network });
    res.json(a);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Address already saved' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', auth, async (req, res) => {
  await Address.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ ok: true });
});

module.exports = router;