const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pair:     { type: String, required: true },       // 'BTC/USDT'
  base:     { type: String, required: true },       // 'BTC'
  amount:   { type: Number, required: true },       // amount of base held
  avgCost:  { type: Number, required: true },       // average USD cost per unit
  realized:{ type: Number, default: 0 },            // cumulative realized PnL
  updatedAt:{ type: Date, default: Date.now }
});

positionSchema.index({ user: 1, pair: 1 }, { unique: true });

module.exports = mongoose.model('Position', positionSchema);