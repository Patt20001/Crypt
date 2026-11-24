require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoose = require('mongoose');
const connectDB = require('./config/database');
const maintenance = require('./middleware/maintenance');
const marketSync = require('./middleware/marketSync');
const traderSync = require('./middleware/traderSync');
const blockchainWatcher = require('./middleware/blockchainWatcher');

const app = express();
connectDB();

// Behind a reverse proxy (nginx, Cloudflare, etc.) set TRUST_PROXY=1 so rate limits use the real client IP.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// Security headers. CSP is left off for now because pages use inline scripts; enable it once those are externalised.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));

// Same-origin by default. To allow other origins (e.g. a separate frontend domain), set CORS_ORIGINS="https://a.com,https://b.com".
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : { origin: false }));

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

// Stricter limits on sensitive endpoints
const strict = (windowMs, max, message) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  message: { error: message }
});
app.use('/api/auth/login',            strict(15 * 60 * 1000, 10, 'Too many login attempts. Please try again in 15 minutes.'));
app.use('/api/auth/register',         strict(60 * 60 * 1000, 10, 'Too many sign-up attempts. Please try again later.'));
app.use('/api/auth/forgot-password',  strict(15 * 60 * 1000, 10, 'Too many reset attempts. Please try again in 15 minutes.'));
app.use('/api/auth/2fa',              strict(15 * 60 * 1000, 30, 'Too many 2FA attempts. Please try again shortly.'));
app.use('/api/wallet/withdraw',       strict(60 * 60 * 1000, 10, 'Too many withdrawal requests. Please try again later.'));
app.use('/api/wallet/whitelist',      strict(60 * 60 * 1000, 30, 'Too many address changes. Please try again later.'));
app.use('/api/profile/password',      strict(60 * 60 * 1000, 10, 'Too many password change attempts. Please try again later.'));

// ============================================================
// 3. JSON PARSER — runs AFTER webhooks (so webhook gets raw body)
// ============================================================
app.use(express.json({ limit: '10mb' }));

// ============================================================
// 4. STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// Public service status (stays available during maintenance)
app.get('/api/status', async (req, res) => {
  let maintenance = { active: false, message: '' };
  try {
    const Settings = require('./models/Settings');
    const m = await Settings.findOne({ key: 'maintenance' }).lean();
    if (m?.value?.active) maintenance = { active: true, message: m.value.message || '' };
  } catch {}
  res.json({
    api: 'operational',
    database: mongoose.connection.readyState === 1 ? 'operational' : 'degraded',
    maintenance,
    checkedAt: new Date().toISOString()
  });
});

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
app.use('/api/support',       require('./routes/support'));
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
app.use('/api/market',        require('./routes/market'));

// ============================================================
// 7. LANDING PAGE
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

// Unknown API routes -> JSON 404; unknown pages -> branded 404 page
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});

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