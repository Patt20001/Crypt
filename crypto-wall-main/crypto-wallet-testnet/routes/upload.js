const express = require('express');
const path = require('path');
const fs = require('fs');
const { kycUpload, selfieUpload, kycDir, selfieDir } = require('../middleware/upload');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

/* Upload KYC document */
router.post('/kyc', auth, kycUpload.single('document'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const user = await User.findById(req.user._id);
    const url = `/uploads/kyc/${req.file.filename}`;

    user.kycDocuments = user.kycDocuments || [];
    user.kycDocuments.push({
      filename: req.file.filename,
      url,
      mimetype: req.file.mimetype,
      size: req.file.size,
      uploadedAt: new Date()
    });
    user.kycStatus = 'pending';
    await user.save();

    res.json({ ok: true, url, kycStatus: user.kycStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Delete KYC document */
router.delete('/kyc/:filename', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.kycStatus === 'verified')
      return res.status(400).json({ error: 'Verified documents cannot be removed' });

    user.kycDocuments = (user.kycDocuments || []).filter(d => d.filename !== req.params.filename);
    await user.save();

    const filePath = path.join(kycDir, req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Upload selfie */
router.post('/selfie', auth, selfieUpload.single('selfie'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const user = await User.findById(req.user._id);

    // Delete old selfie if exists
    if (user.kycSelfie?.url) {
      const oldFile = path.join(selfieDir, path.basename(user.kycSelfie.url));
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    }

    user.kycSelfie = {
      url: `/uploads/selfies/${req.file.filename}`,
      uploadedAt: new Date()
    };
    if (user.kycStatus === 'unverified') user.kycStatus = 'pending';
    await user.save();

    res.json({ ok: true, url: user.kycSelfie.url, kycStatus: user.kycStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* Delete selfie */
router.delete('/selfie', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.kycStatus === 'verified')
      return res.status(400).json({ error: 'Cannot remove after verification' });

    if (user.kycSelfie?.url) {
      const file = path.join(selfieDir, path.basename(user.kycSelfie.url));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    user.kycSelfie = { url: '', uploadedAt: null };
    await user.save();

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;