const express = require('express');
const path = require('path');
const fs = require('fs');
const upload = require('../middleware/upload');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const router = express.Router();

// Upload a KYC document
router.post('/kyc', auth, upload.single('document'), async (req, res) => {
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

// Delete own doc (only while unverified/pending)
router.delete('/kyc/:filename', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.kycStatus === 'verified')
      return res.status(400).json({ error: 'Verified documents cannot be removed' });

    user.kycDocuments = (user.kycDocuments || []).filter(d => d.filename !== req.params.filename);
    await user.save();

    const filePath = path.join(__dirname, '..', 'public', 'uploads', 'kyc', req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;