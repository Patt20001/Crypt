const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label:   { type: String, required: true },
  address: { type: String, required: true },
  network: { type: String, default: 'TRC20' },
  createdAt:{ type: Date, default: Date.now }
});

addressSchema.index({ user: 1, address: 1 }, { unique: true });

module.exports = mongoose.model('Address', addressSchema);