const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  referee:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  bonusPaid:{ type: Boolean, default: false },
  bonus:    { type: Number, default: 5 },
  createdAt:{ type: Date, default: Date.now }
});

module.exports = mongoose.model('Referral', referralSchema);