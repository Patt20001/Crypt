require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const maintenance = require('./middleware/maintenance');

const app = express();
connectDB();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 150 });
app.use('/api', limiter);
app.use('/api', maintenance);

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 NovaWallet running on http://localhost:${PORT}`));