const mongoose = require('mongoose');

const notifSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, enum: ['deposit','withdraw','stake','kyc','security','referral','system'], default: 'system' },
  title:   { type: String, required: true },
  body:    { type: String, default: '' },
  read:    { type: Boolean, default: false },
  link:    { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notifSchema);