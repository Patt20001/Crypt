const mongoose = require('mongoose');

const copyRelationSchema = new mongoose.Schema({
  follower:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trader:      { type: mongoose.Schema.Types.ObjectId, ref: 'CopyTrader', required: true },
  allocation:  { type: Number, required: true },
  autoCopy:    { type: Boolean, default: true },
  active:      { type: Boolean, default: true },
  pnl:         { type: Number, default: 0 },

  traderFees:  { type: Number, default: 0 },
  platformFees:{ type: Number, default: 0 },
  lastFeeSettledAt: { type: Date, default: Date.now },
  highWaterMark: { type: Number, default: 0 },

  createdAt:   { type: Date, default: Date.now }
});

copyRelationSchema.index({ follower: 1, trader: 1 }, { unique: true });

module.exports = mongoose.model('CopyRelation', copyRelationSchema);