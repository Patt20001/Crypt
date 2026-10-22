const mongoose = require('mongoose');

const positionSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pair:     { type: String, required: true },
  base:     { type: String, required: true },
  amount:   { type: Number, required: true },
  avgCost:  { type: Number, required: true },
  realized: { type: Number, default: 0 },

  // 👇 SL/TP on the position (not on the order)
  stopLoss:   { type: Number, default: 0 },
  takeProfit: { type: Number, default: 0 },

  updatedAt:{ type: Date, default: Date.now }
});

positionSchema.index({ user: 1, pair: 1 }, { unique: true });

module.exports = mongoose.model('Position', positionSchema);