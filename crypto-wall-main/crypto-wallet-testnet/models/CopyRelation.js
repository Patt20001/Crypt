const mongoose = require('mongoose');

const copyRelationSchema = new mongoose.Schema({
  follower:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trader:    { type: mongoose.Schema.Types.ObjectId, ref: 'CopyTrader', required: true },
  allocation:{ type: Number, required: true },     // USDT the follower allocated
  autoCopy:  { type: Boolean, default: true },
  active:    { type: Boolean, default: true },
  pnl:       { type: Number, default: 0 },         // cumulative PnL from copied trades
  createdAt: { type: Date, default: Date.now }
});

copyRelationSchema.index({ follower: 1, trader: 1 }, { unique: true });

module.exports = mongoose.model('CopyRelation', copyRelationSchema);