const express = require('express');
const CopyTrader = require('../models/CopyTrader');
const LeaderboardSnapshot = require('../models/LeaderboardSnapshot');
const { auth } = require('../middleware/auth');
const router = express.Router();

function getWeekId(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

router.get('/current', auth, async (req, res) => {
  try {
    const traders = await CopyTrader.find({ active: true })
      .sort({ roi30d: -1, winRate: -1 })
      .limit(10)
      .select('displayName tier roi30d winRate followers totalEarned featured');

    res.json({
      weekId: getWeekId(),
      entries: traders.map((t, i) => ({ ...t.toObject(), rank: i + 1 }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', auth, async (req, res) => {
  try {
    const weeks = await LeaderboardSnapshot.find()
      .sort({ weekStart: -1 })
      .limit(8)
      .populate('entries.trader', 'displayName tier');
    res.json(weeks);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/snapshot', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const weekId = getWeekId();
    const existing = await LeaderboardSnapshot.findOne({ weekId });
    if (existing) return res.json({ message: 'Snapshot already exists for this week', weekId });

    const traders = await CopyTrader.find({ active: true })
      .sort({ roi30d: -1, winRate: -1 })
      .limit(10);

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const entries = traders.map((t, i) => ({
      trader: t._id,
      rank: i + 1,
      roi30d: t.roi30d,
      winRate: t.winRate,
      followers: t.followers,
      totalEarned: t.totalEarned || 0
    }));

    const snap = await LeaderboardSnapshot.create({ weekId, weekStart, weekEnd, entries });
    res.json(snap);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;