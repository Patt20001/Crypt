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
  fee: { type: Number, default: 0 },
  netAmount: { type: Number, default: 0 },
  status:  { type: String, enum: ['pending', 'completed', 'rejected'], default: 'pending' },
  note:    { type: String, default: '' },
  address: { type: String, default: '' },
  network: { type: String, default: '' },
  txHash:  { type: String, default: '', index: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmations: { type: Number, default: 0 },
  requiredConfirmations: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Prevent duplicate on-chain deposits from being recorded more than once.
txSchema.index({ network: 1, txHash: 1 }, { unique: true, partialFilterExpression: { txHash: { $type: 'string', $gt: '' } } });

module.exports = mongoose.model('Transaction', txSchema);