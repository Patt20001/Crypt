require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const maintenance = require('./middleware/maintenance');
const marketSync = require('./middleware/marketSync');
const traderSync = require('./middleware/traderSync');
const blockchainWatcher = require('./middleware/blockchainWatcher');

const app = express();
connectDB();

app.use(cors());

// ============================================================
// 1. WEBHOOK ROUTE — MUST BE BEFORE express.json() and rate limiter
//    Alchemy sends raw body; we need it untouched for signature verification
// ============================================================
app.use('/api/webhooks', require('./routes/webhooks'));

// ============================================================
// 2. RATE LIMITER — skips /api/webhooks
// ============================================================
const limiter = rateLimit({ windowMs: 60 * 1000, max: 150 });
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/webhooks')) return next();
  return limiter(req, res, next);
});

// ============================================================
// 3. JSON PARSER — runs AFTER webhooks (so webhook gets raw body)
// ============================================================
app.use(express.json({ limit: '10mb' }));

// ============================================================
// 4. STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 5. MAINTENANCE MIDDLEWARE
// ============================================================
app.use('/api', maintenance);

// ============================================================
// 6. API ROUTES
// ============================================================
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/wallet',        require('./routes/wallet'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/staking',       require('./routes/staking'));
app.use('/api/profile',       require('./routes/profile'));
app.use('/api/networks',      require('./routes/networks'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/swap',          require('./routes/swap'));
app.use('/api/upload',        require('./routes/upload'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/referrals',     require('./routes/referrals'));
app.use('/api/addresses',     require('./routes/addresses'));
app.use('/api/portfolio',     require('./routes/portfolio'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/copy',          require('./routes/copy'));
app.use('/api/leaderboard',   require('./routes/leaderboard'));

// ============================================================
// 7. LANDING PAGE
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// ============================================================
// 8. SERVER START
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 NovaWallet running on http://localhost:${PORT}`);
  marketSync.start();
  traderSync.start();
  blockchainWatcher.start();
});