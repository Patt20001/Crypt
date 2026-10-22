const mongoose = require('mongoose');

const leaderboardSnapshotSchema = new mongoose.Schema({
  weekId:     { type: String, required: true },
  weekStart:  { type: Date, required: true },
  weekEnd:    { type: Date, required: true },
  entries: [{
    trader:   { type: mongoose.Schema.Types.ObjectId, ref: 'CopyTrader' },
    rank:     Number,
    roi30d:   Number,
    winRate:  Number,
    followers:Number,
    totalEarned: Number
  }],
  createdAt: { type: Date, default: Date.now }
});

leaderboardSnapshotSchema.index({ weekId: 1 }, { unique: true });

module.exports = mongoose.model('LeaderboardSnapshot', leaderboardSnapshotSchema);