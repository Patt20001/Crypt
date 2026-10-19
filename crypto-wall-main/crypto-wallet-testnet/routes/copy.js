const express = require('express');
const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

/* GET all copy traders */
router.get('/', auth, async (req, res) => {
  const traders = await CopyTrader.find({ active: true }).sort({ featured: -1, roi30d: -1 });
  res.json(traders);
});

/* GET my copy relations */
router.get('/my', auth, async (req, res) => {
  const relations = await CopyRelation.find({ follower: req.user._id, active: true })
    .populate('trader');
  res.json(relations);
});

/* POST follow a trader */
router.post('/follow/:traderId', auth, async (req, res) => {
  try {
    const { allocation } = req.body;
    const amt = Number(allocation);
    if (!amt || amt < 10) return res.status(400).json({ error: 'Minimum allocation is 10 USDT' });

    const trader = await CopyTrader.findById(req.params.traderId);
    if (!trader || !trader.active) return res.status(404).json({ error: 'Trader not found' });

    const existing = await CopyRelation.findOne({ follower: req.user._id, trader: trader._id });
    if (existing && existing.active) return res.status(400).json({ error: 'Already following' });

    const user = await User.findById(req.user._id);
    if (user.balances.USDT < amt) return res.status(400).json({ error: 'Insufficient USDT' });

    user.balances.USDT -= amt;
    user.locked.USDT = (user.locked.USDT || 0) + amt;
    await user.save();

    let relation;
    if (existing) {
      existing.allocation = amt;
      existing.active = true;
      existing.autoCopy = true;
      existing.pnl = 0;
      relation = await existing.save();
    } else {
      relation = await CopyRelation.create({
        follower: user._id, trader: trader._id, allocation: amt
      });
    }

    trader.followers += 1;
    await trader.save();

    await notify(user._id, 'system', 'Copy trading started',
      `Following ${trader.displayName} with ${amt} USDT`);

    res.json(relation);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST unfollow */
router.post('/unfollow/:relationId', auth, async (req, res) => {
  try {
    const rel = await CopyRelation.findOne({
      _id: req.params.relationId,
      follower: req.user._id
    }).populate('trader');
    if (!rel) return res.status(404).json({ error: 'Not found' });

    const user = await User.findById(req.user._id);
    user.locked.USDT = Math.max(0, (user.locked.USDT || 0) - rel.allocation);
    user.balances.USDT += rel.allocation + (rel.pnl || 0);
    await user.save();

    rel.active = false;
    await rel.save();

    if (rel.trader) {
      rel.trader.followers = Math.max(0, rel.trader.followers - 1);
      await rel.trader.save();
    }

    await notify(user._id, 'system', 'Copy trading stopped',
      `Returned ${rel.allocation + (rel.pnl || 0)} USDT to your wallet`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST seed demo traders — admin only */
router.post('/seed', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const force = req.query.force === 'true';

    // Force mode: wipe and reseed
    if (force) {
      await CopyTrader.deleteMany({});
    } else {
      const existing = await CopyTrader.countDocuments();
      if (existing > 0) {
        return res.json({
          message: 'Already seeded',
          count: existing,
          hint: 'Use ?force=true to reset and reseed'
        });
      }
    }

    const traders = await CopyTrader.insertMany([
      { displayName: 'Alpha Whale',    bio: 'Swing trader focusing on BTC/ETH breakouts',
        tier: 'diamond', roi30d: 42.5, winRate: 71, followers: 1284, totalTrades: 892, featured: true },
      { displayName: 'DeFi Degen',     bio: 'Altcoin hunter. High risk, high reward',
        tier: 'gold',    roi30d: 28.3, winRate: 63, followers: 674, totalTrades: 1203, featured: true },
      { displayName: 'Steady Eddie',   bio: 'Conservative BTC accumulation strategy',
        tier: 'silver',  roi30d: 12.1, winRate: 78, followers: 312, totalTrades: 445 },
      { displayName: 'Momentum Mike',  bio: 'Breakout scalper on SOL/BNB',
        tier: 'gold',    roi30d: 22.8, winRate: 58, followers: 891, totalTrades: 2104 },
      { displayName: 'Patient Paul',   bio: 'Long-term holder, low frequency',
        tier: 'bronze',  roi30d: 6.4,  winRate: 82, followers: 156, totalTrades: 87 },
      { displayName: 'Scalpel Sarah',  bio: 'Intraday trader with tight stops',
        tier: 'diamond', roi30d: 38.7, winRate: 66, followers: 2103, totalTrades: 4521 }
    ]);

    res.json({ message: 'Seeded', count: traders.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;