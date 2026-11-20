const mongoose = require('mongoose');

const txSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, enum: ['deposit', 'withdraw', 'earn'], required: true },
  currency:{ type: String, default: 'USDT' },
  category: { type: String, default: '' },
  direction: { type: String, enum: ['credit', 'debit', ''], default: '' },
  pair: { type: String, default: '' },
  side: { type: String, enum: ['buy', 'sell', ''], default: '' },
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  referenceId: { type: String, default: '', index: true },
  amount:  { type: Number, required: true },
  status:  { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending' },
  note:    { type: String, default: '' },
  address: { type: String, default: '' },
  network: { type: String, default: '' },
  txHash:  { type: String, default: '', index: true },
  confirmations: { type: Number, default: 0 },
  requiredConfirmations: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', txSchema);