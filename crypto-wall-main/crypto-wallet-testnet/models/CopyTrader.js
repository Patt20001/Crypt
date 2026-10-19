const mongoose = require('mongoose');

const copyTraderSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  displayName: { type: String, required: true },
  bio:         { type: String, default: '' },
  tier:        { type: String, enum: ['bronze', 'silver', 'gold', 'diamond'], default: 'bronze' },
  roi30d:      { type: Number, default: 0 },
  winRate:     { type: Number, default: 0 },
  followers:   { type: Number, default: 0 },
  totalTrades: { type: Number, default: 0 },
  featured:    { type: Boolean, default: false },
  active:      { type: Boolean, default: true },
  createdAt:   { type: Date, default: Date.now }
});

module.exports = mongoose.model('CopyTrader', copyTraderSchema);