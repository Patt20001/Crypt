const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // ============================================================
  // Basic account
  // ============================================================
  username: { type: String, required: true, unique: true, trim: true, minlength: 3 },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['user', 'admin'], default: 'user' },

  // ============================================================
  // Profile
  // ============================================================
  displayName: { type: String, default: '' },
  country:     { type: String, default: '' },

  // ============================================================
  // 2FA (TOTP)
  // ============================================================
  twoFA:              { type: Boolean, default: false },
  twoFASecret:        { type: String, default: '' },
  twoFAPendingSecret: { type: String, default: '' },
  twoFARecoveryCodes: { type: [String], default: [] },

  // ============================================================
  // KYC
  // ============================================================
  kycStatus: {
    type: String,
    enum: ['unverified', 'pending', 'verified'],
    default: 'unverified'
  },

  // KYC personal info
  firstName:   { type: String, default: '' },
  lastName:    { type: String, default: '' },
  dateOfBirth: { type: Date,   default: null },

  // KYC uploaded documents
  kycDocuments: [{
    filename:   String,
    url:        String,
    mimetype:   String,
    size:       Number,
    uploadedAt: { type: Date, default: Date.now }
  }],

  // KYC selfie
  kycSelfie: {
    url:        { type: String, default: '' },
    uploadedAt: { type: Date,   default: null }
  },

  // ============================================================
  // Security questions (for password recovery)
  // ============================================================
  securityQuestions: [{
    question:   { type: String },
    answerHash: { type: String }
  }],
  securityQuestionsSetAt: { type: Date, default: null },

  // ============================================================
  // Password reset
  // ============================================================
  resetToken:        { type: String, default: '' },
  resetTokenExpires: { type: Date,   default: null },

  // ============================================================
  // Balances (production-grade networks only)
  // ============================================================
  balances: {
    USDT: { type: Number, default: 0 },
    ETH:  { type: Number, default: 0 },
    BNB:  { type: Number, default: 0 }
  },
  locked: {
    USDT: { type: Number, default: 0 },
    ETH:  { type: Number, default: 0 },
    BNB:  { type: Number, default: 0 }
  },

  // ============================================================
  // HD wallet deposit addresses (one per network)
  // ============================================================
  depositAddressIndex: { type: Number, default: null },
  depositAddresses: {
    TRC20: { type: String, default: '' },
    ERC20: { type: String, default: '' },
    BEP20: { type: String, default: '' }
  },

  // ============================================================
  // Referrals
  // ============================================================
  referralCode: { type: String, unique: true, sparse: true },
  referredBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // ============================================================
  // Terms acceptance
  // ============================================================
  acceptedTermsAt: { type: Date, default: null },

  // ============================================================
  // Session management
  // ============================================================
  tokenVersion: { type: Number, default: 0 },
  lastLogin: {
    ip:        String,
    userAgent: String,
    at:        Date
  },
  loginHistory: [{
    ip:        String,
    userAgent: String,
    at:        { type: Date, default: Date.now }
  }],

  // ============================================================
  // Account status
  // ============================================================
  isBanned:  { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);