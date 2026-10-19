const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { verifyTOTP, generateSecret, buildOtpAuthURI } = require('../utils/totp');

const User = require('../models/User');
const Referral = require('../models/Referral');
const { notify } = require('../middleware/notify');
const { auth } = require('../middleware/auth');

const router = express.Router();

const APP_NAME = 'NovaWallet';

const sign = (user) => jwt.sign(
  { id: user._id, role: user.role, v: user.tokenVersion || 0 },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES }
);

function genRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

/* ============================================================
   REGISTER
   ============================================================ */
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, referralCode, acceptTerms } = req.body;
    if (!username || !email || !password)
      return res.status(400).json({ error: 'All fields required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password min 6 characters' });
    if (!acceptTerms)
      return res.status(400).json({ error: 'You must accept the Terms & Risk Disclosure' });

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(409).json({ error: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);

    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode: referralCode.toUpperCase() });
    }

    const user = await User.create({
      username,
      email,
      password: hashed,
      referralCode: 'NVW' + Math.random().toString(36).slice(2, 8).toUpperCase(),
      acceptedTermsAt: new Date(),
      referredBy: referrer?._id || null
    });

    if (referrer && referrer._id.toString() !== user._id.toString()) {
      await Referral.create({
        referrer: referrer._id,
        referee: user._id,
        bonusPaid: false
      });
      await notify(
        referrer._id,
        'referral',
        'New referral!',
        `${username} signed up using your code. You'll earn 5 USDT when they make their first deposit.`
      );
    }

    await notify(
      user._id,
      'system',
      'Welcome to NovaWallet',
      'Complete KYC to unlock higher withdrawal limits.'
    );

    res.json({
      token: sign(user),
      user: { id: user._id, username, email, role: user.role }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   LOGIN
   ============================================================ */
router.post('/login', async (req, res) => {
  try {
    const { email, password, code } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.isBanned) return res.status(403).json({ error: 'Account banned' });

    // ---------- 2FA gate ----------
    if (user.twoFA) {
      if (!code) {
        return res.status(401).json({
          error: '2FA code required',
          requires2FA: true
        });
      }

      const cleanCode = String(code).replace(/\s/g, '');
      const isTotp = verifyTOTP(cleanCode, user.twoFASecret);
      const isRecovery = (user.twoFARecoveryCodes || []).includes(cleanCode.toUpperCase());

      if (!isTotp && !isRecovery) {
        return res.status(401).json({
          error: 'Invalid or expired 2FA code',
          requires2FA: true
        });
      }

      if (isRecovery) {
        user.twoFARecoveryCodes = user.twoFARecoveryCodes.filter(
          c => c !== cleanCode.toUpperCase()
        );
        await user.save();
        await notify(
          user._id,
          'security',
          'Recovery code used',
          `A recovery code was used to log in. ${user.twoFARecoveryCodes.length} codes remaining.`
        );
      }
    }

    // ---------- login succeeded ----------
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    user.lastLogin = { ip, userAgent: ua, at: new Date() };
    user.loginHistory = [
      { ip, userAgent: ua, at: new Date() },
      ...(user.loginHistory || [])
    ].slice(0, 5);
    await user.save();

    res.json({
      token: sign(user),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   CURRENT USER
   ============================================================ */
router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

/* ============================================================
   2FA SETUP — STEP 1: Generate secret + QR URI
   ============================================================ */
router.post('/2fa/setup', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.twoFA) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    const secret = generateSecret(20);
    const otpauth = buildOtpAuthURI({
      issuer: APP_NAME,
      account: user.email,
      secret
    });

    user.twoFAPendingSecret = secret;
    await user.save();

    res.json({
      secret,
      otpauth,
      issuer: APP_NAME,
      account: user.email
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   2FA SETUP — STEP 2: Verify code and enable
   ============================================================ */
router.post('/2fa/enable', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const user = await User.findById(req.user._id);
    if (user.twoFA) return res.status(400).json({ error: 'Already enabled' });
    if (!user.twoFAPendingSecret)
      return res.status(400).json({ error: 'No setup in progress. Start over.' });

    const cleanCode = String(code).replace(/\s/g, '');
    const valid = verifyTOTP(cleanCode, user.twoFAPendingSecret);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid code — check your authenticator app' });
    }

    user.twoFA = true;
    user.twoFASecret = user.twoFAPendingSecret;
    user.twoFAPendingSecret = '';
    user.twoFARecoveryCodes = genRecoveryCodes(8);
    await user.save();

    await notify(
      user._id,
      'security',
      '2FA enabled',
      'Two-factor authentication is now active on your account.'
    );

    res.json({
      ok: true,
      recoveryCodes: user.twoFARecoveryCodes
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   2FA — VERIFY CODE (used for withdrawals & sensitive actions)
   ============================================================ */
router.post('/2fa/verify', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const user = await User.findById(req.user._id);
    if (!user.twoFA) return res.status(400).json({ error: '2FA is not enabled' });

    const cleanCode = String(code).replace(/\s/g, '');
    const isTotp = verifyTOTP(cleanCode, user.twoFASecret);
    const isRecovery = (user.twoFARecoveryCodes || []).includes(cleanCode.toUpperCase());

    if (!isTotp && !isRecovery)
      return res.status(400).json({ error: 'Invalid or expired code' });

    if (isRecovery) {
      user.twoFARecoveryCodes = user.twoFARecoveryCodes.filter(
        c => c !== cleanCode.toUpperCase()
      );
      await user.save();
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   2FA — DISABLE (requires password + current code)
   ============================================================ */
router.post('/2fa/disable', auth, async (req, res) => {
  try {
    const { password, code } = req.body;
    if (!password || !code)
      return res.status(400).json({ error: 'Password and 2FA code required' });

    const user = await User.findById(req.user._id);
    if (!user.twoFA) return res.status(400).json({ error: '2FA is not enabled' });

    const pwdOk = await bcrypt.compare(password, user.password);
    if (!pwdOk) return res.status(401).json({ error: 'Incorrect password' });

    const cleanCode = String(code).replace(/\s/g, '');
    const valid = verifyTOTP(cleanCode, user.twoFASecret);
    if (!valid) return res.status(400).json({ error: 'Invalid 2FA code' });

    user.twoFA = false;
    user.twoFASecret = '';
    user.twoFAPendingSecret = '';
    user.twoFARecoveryCodes = [];
    await user.save();

    await notify(
      user._id,
      'security',
      '2FA disabled',
      'Two-factor authentication has been removed from your account.'
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ============================================================
   2FA — REGENERATE RECOVERY CODES (requires current code)
   ============================================================ */
router.post('/2fa/recovery-codes', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const user = await User.findById(req.user._id);
    if (!user.twoFA) return res.status(400).json({ error: '2FA is not enabled' });

    const valid = verifyTOTP(String(code).replace(/\s/g, ''), user.twoFASecret);
    if (!valid) return res.status(400).json({ error: 'Invalid 2FA code' });

    user.twoFARecoveryCodes = genRecoveryCodes(8);
    await user.save();

    res.json({ recoveryCodes: user.twoFARecoveryCodes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;