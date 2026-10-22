const express = require('express');
const multer = require('multer');
const CopyTrader = require('../models/CopyTrader');
const CopyRelation = require('../models/CopyRelation');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { notify } = require('../middleware/notify');
const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
      existing.highWaterMark = 0;
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

/* POST populate — generate 100+ realistic traders (admin only) */
router.post('/populate', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }

    const count = Math.min(Number(req.query.count) || 100, 250);

    const FIRST = ['Alex','Sam','Jordan','Taylor','Morgan','Casey','Riley','Jamie','Avery','Quinn',
      'Kai','Noor','Zara','Omar','Mia','Leo','Nia','Ravi','Sara','Theo','Ivy','Ezra','Luna',
      'Priya','Diego','Anya','Kofi','Yuki','Hana','Rami','Akio','Nora','Idris','Lina','Mateo','Ade',
      'Zoe','Ivan','Fatima','Oscar','Nina','Hugo','Elif','Jonas','Amara','Kenji','Salma','Rico','Leila'];
    const LAST = ['Trader','Capital','Alpha','Delta','Prime','Edge','Quant','Rocket','Bear','Bull',
      'Scalper','Swing','Whale','Flow','Ventures','Signal','Chart','Byte','Node','Fund','Hunter',
      'Pulse','Wave','Momentum','Trend','Stack','Gain','Yield','Lever','Spot'];
    const SUFFIX = ['','_fx','Trade','_pro','X','_capital','_labs','_v2','',''];
    const BIOS = [
      'Systematic trend follower focused on BTC and ETH breakouts.',
      'Altcoin hunter with a bias toward early momentum plays.',
      'Risk-managed swing trader using volume confirmation.',
      'Intraday scalper on the SOL/BNB rotation.',
      'Long-biased accumulator with multi-month horizons.',
      'Mean-reversion trader focused on high-volatility altcoins.',
      'Breakout specialist on large-cap crypto.',
      'Quant-driven trader using momentum and volatility filters.',
      'Conservative portfolio approach with tight risk limits.',
      'Event-driven trader playing major market catalysts.',
      'Grid bot manager with automated rebalancing.',
      'Macro-aligned swing trader playing crypto cycles.',
      'Order-flow focused trader watching liquidations.',
      'Delta-neutral carry strategy with USDT lending.',
      'Momentum scalper with 1m and 5m timeframes.',
      'Range trader on sideways markets and consolidation.',
      'Volatility premium collector via options and spot.',
      'Narrative-driven trader following narrative rotation.'
    ];
    const TIERS = ['bronze','bronze','silver','silver','gold','gold','diamond'];

    function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function rndBetween(a, b, dec = 2) { return +(Math.random() * (b - a) + a).toFixed(dec); }

    const toInsert = [];
    const seen = new Set();
    let attempts = 0;

    while (toInsert.length < count && attempts < count * 10) {
      attempts++;
      const name = `${rnd(FIRST)} ${rnd(LAST)}${rnd(SUFFIX)}`;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());

      const tier = rnd(TIERS);
      const roi30d = tier === 'diamond' ? rndBetween(25, 65)
                   : tier === 'gold'    ? rndBetween(12, 38)
                   : tier === 'silver'  ? rndBetween(4, 18)
                   :                       rndBetween(-3, 8);
      const winRate = tier === 'diamond' ? rndBetween(64, 82, 0)
                   : tier === 'gold'    ? rndBetween(56, 74, 0)
                   : tier === 'silver'  ? rndBetween(48, 66, 0)
                   :                       rndBetween(40, 58, 0);
      const totalTrades = Math.floor(Math.random() * 4000) + 50;
      const followers = Math.floor(Math.random() * 3000 * (tier === 'diamond' ? 3 : 1));

      toInsert.push({
        displayName: name,
        bio: rnd(BIOS),
        tier,
        roi30d,
        winRate,
        totalTrades,
        followers,
        performanceFee: tier === 'diamond' ? 15 : 10,
        platformFee: 2,
        featured: tier === 'diamond' && Math.random() > 0.7,
        active: true
      });
    }

    const inserted = await CopyTrader.insertMany(toInsert, { ordered: false });

    res.json({
      message: `Generated ${inserted.length} traders`,
      count: inserted.length,
      total: await CopyTrader.countDocuments()
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET all copy relations — admin only */
router.get('/admin/relations', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const relations = await CopyRelation.find()
      .populate('follower', 'username email')
      .populate('trader', 'displayName tier performanceFee platformFee')
      .sort({ createdAt: -1 });
    res.json(relations);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET copy trading stats — admin only */
router.get('/admin/stats', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const activeRelations = await CopyRelation.countDocuments({ active: true });
    const totalAllocatedAgg = await CopyRelation.aggregate([
      { $match: { active: true } },
      { $group: { _id: null, total: { $sum: '$allocation' } } }
    ]);
    const traders = await CopyTrader.countDocuments({ active: true });
    const totalFollowersAgg = await CopyTrader.aggregate([
      { $match: { active: true } },
      { $group: { _id: null, total: { $sum: '$followers' } } }
    ]);
    res.json({
      activeRelations,
      totalAllocated: totalAllocatedAgg[0]?.total || 0,
      traders,
      totalFollowers: totalFollowersAgg[0]?.total || 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* GET profit-sharing totals — admin only */
router.get('/admin/fees', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const totalTraderFees = await CopyRelation.aggregate([
      { $group: { _id: null, total: { $sum: '$traderFees' } } }
    ]);
    const totalPlatformFees = await CopyRelation.aggregate([
      { $group: { _id: null, total: { $sum: '$platformFees' } } }
    ]);
    const topTraders = await CopyTrader.find({ totalEarned: { $gt: 0 } })
      .sort({ totalEarned: -1 })
      .limit(10)
      .select('displayName tier totalEarned followers');

    res.json({
      totalTraderFees: totalTraderFees[0]?.total || 0,
      totalPlatformFees: totalPlatformFees[0]?.total || 0,
      topTraders
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST force-stop a copy relation — admin only */
router.post('/admin/relations/:id/stop', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const rel = await CopyRelation.findById(req.params.id).populate('trader');
    if (!rel || !rel.active) return res.status(404).json({ error: 'Not found or inactive' });

    const user = await User.findById(rel.follower);
    if (user) {
      user.locked.USDT = Math.max(0, (user.locked.USDT || 0) - rel.allocation);
      user.balances.USDT += rel.allocation + (rel.pnl || 0);
      await user.save();
    }
    rel.active = false;
    await rel.save();
    if (rel.trader) {
      rel.trader.followers = Math.max(0, rel.trader.followers - 1);
      await rel.trader.save();
    }

    await notify(user._id, 'system', 'Copy trading stopped by admin',
      `${rel.allocation + (rel.pnl || 0)} USDT returned to your wallet`);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST import traders from CSV — admin only */
router.post('/import', auth, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const csv = req.file.buffer.toString('utf-8');
    const lines = csv.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + data' });

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const required = ['displayname', 'bio', 'tier', 'roi30d', 'winrate'];
    for (const col of required) {
      if (!header.includes(col)) {
        return res.status(400).json({
          error: `Missing required column: ${col}. Required: ${required.join(', ')}`
        });
      }
    }

    const idx = col => header.indexOf(col);
    const validTiers = ['bronze', 'silver', 'gold', 'diamond'];

    const toInsert = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      const name = cols[idx('displayname')];
      if (!name) { errors.push(`Line ${i + 1}: empty displayName`); continue; }

      const tier = cols[idx('tier')]?.toLowerCase();
      if (!validTiers.includes(tier)) {
        errors.push(`Line ${i + 1}: invalid tier "${tier}"`);
        continue;
      }

      toInsert.push({
        displayName: name,
        bio: cols[idx('bio')] || '',
        tier,
        roi30d: Number(cols[idx('roi30d')]) || 0,
        winRate: Number(cols[idx('winrate')]) || 0,
        followers: header.includes('followers') ? (Number(cols[idx('followers')]) || 0) : 0,
        totalTrades: header.includes('totaltrades') ? (Number(cols[idx('totaltrades')]) || 0) : 0,
        performanceFee: header.includes('performancefee') ? (Number(cols[idx('performancefee')]) || 10) : 10,
        platformFee: header.includes('platformfee') ? (Number(cols[idx('platformfee')]) || 2) : 2,
        active: true
      });
    }

    if (!toInsert.length) {
      return res.status(400).json({ error: 'No valid rows to import', errors });
    }

    const inserted = await CopyTrader.insertMany(toInsert, { ordered: false });

    res.json({
      message: `Imported ${inserted.length} traders`,
      count: inserted.length,
      errors,
      total: await CopyTrader.countDocuments()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* POST set profit-sharing fee for a trader — admin only */
router.post('/admin/traders/:id/fees', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { performanceFee, platformFee } = req.body;
    const perf = Number(performanceFee);
    const plat = Number(platformFee);
    if (perf < 0 || perf > 50) return res.status(400).json({ error: 'Performance fee must be 0–50%' });
    if (plat < 0 || plat > 20) return res.status(400).json({ error: 'Platform fee must be 0–20%' });

    const trader = await CopyTrader.findByIdAndUpdate(
      req.params.id,
      { performanceFee: perf, platformFee: plat },
      { new: true }
    );
    if (!trader) return res.status(404).json({ error: 'Trader not found' });
    res.json(trader);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST adjust copy relation PnL — admin only (for demos/support) */
router.post('/admin/relations/:id/adjust', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { amount, reason } = req.body;
    const amt = Number(amount);
    if (!amt) return res.status(400).json({ error: 'Amount required' });

    const rel = await CopyRelation.findById(req.params.id).populate('trader');
    if (!rel) return res.status(404).json({ error: 'Relation not found' });

        rel.pnl = (rel.pnl || 0) + amt;
    await rel.save();

    res.json({ relation: rel, adjustment: amt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;