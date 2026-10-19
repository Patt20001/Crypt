const mongoose = require('mongoose');

const txSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, enum: ['deposit', 'withdraw', 'earn'], required: true },
  currency:{ type: String, enum: ['USDT', 'BTC', 'ETH'], default: 'USDT' },
  amount:  { type: Number, required: true },
  status:  { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending' },
  note:    { type: String, default: '' },
  address: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', txSchema);