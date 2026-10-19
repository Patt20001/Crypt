const express = require('express');
const User = require('../models/User');
const Referral = require('../models/Referral');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.get('/', auth, async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user.referralCode) {
    user.referralCode = 'NVW' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await user.save();
  }

  const list = await Referral.find({ referrer: user._id })
    .populate('referee', 'username createdAt')
    .sort({ createdAt: -1 });

  const paid = list.filter(r => r.bonusPaid).reduce((s, r) => s + r.bonus, 0);

  res.json({
    code: user.referralCode,
    link: `https://novawallet.example/r/${user.referralCode}`,
    invites: list.length,
    totalEarned: paid,
    history: list
  });
});

module.exports = router;