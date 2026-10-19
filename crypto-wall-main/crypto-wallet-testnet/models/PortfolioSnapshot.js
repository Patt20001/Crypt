const mongoose = require('mongoose');

const snapSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: String, required: true },       // YYYY-MM-DD
  usdValue: { type: Number, required: true },
  balances: {
    USDT: Number, BTC: Number, ETH: Number
  },
  createdAt: { type: Date, default: Date.now }
});

snapSchema.index({ user: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('PortfolioSnapshot', snapSchema);