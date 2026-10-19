const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['user', 'admin'], default: 'user' },
  displayName: { type: String, default: '' },
  country:     { type: String, default: '' },
    twoFA:             { type: Boolean, default: false },
  twoFASecret:       { type: String, default: '' },     // base32 TOTP secret
  twoFAPendingSecret:{ type: String, default: '' },     // secret while setting up (not yet confirmed)
  twoFARecoveryCodes:{ type: [String], default: [] },   // one-time backup codes
  kycStatus:   { type: String, enum: ['unverified','pending','verified'], default: 'unverified' },
  kycDocuments: [{
    filename: String, url: String, mimetype: String, size: Number,
    uploadedAt: { type: Date, default: Date.now }
  }],
  balances: {
    USDT: { type: Number, default: 0 },
    BTC:  { type: Number, default: 0 },
    ETH:  { type: Number, default: 0 }
  },
  locked: {
    USDT: { type: Number, default: 0 },
    BTC:  { type: Number, default: 0 },
    ETH:  { type: Number, default: 0 }
  },
  walletAddress: { type: String, default: () => 'T' + Math.random().toString(36).slice(2, 36).toUpperCase() },
  referralCode:  { type: String, unique: true, sparse: true },
  referredBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptedTermsAt: { type: Date, default: null },
  tokenVersion:  { type: Number, default: 0 },
  lastLogin: {
    ip:        String,
    userAgent: String,
    at:        Date
  },
  loginHistory: [{
    ip: String, userAgent: String, at: { type: Date, default: Date.now }
  }],
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);