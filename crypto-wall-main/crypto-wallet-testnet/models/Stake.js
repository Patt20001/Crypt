const mongoose = require('mongoose');

const stakeSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan:         { type: String, enum: ['flexible', '30d', '90d', '180d'], required: true },
  amount:       { type: Number, required: true },
  apy:          { type: Number, required: true },   // e.g. 5.2 for 5.2%
  accrued:      { type: Number, default: 0 },       // running yield
  status:       { type: String, enum: ['active', 'closed'], default: 'active' },
  startedAt:    { type: Date, default: Date.now },
  maturesAt:    { type: Date, required: true },
  lastAccrualAt:{ type: Date, default: Date.now },
  closedAt:     { type: Date, default: null }
});

module.exports = mongoose.model('Stake', stakeSchema);