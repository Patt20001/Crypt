const Settings = require('../models/Settings');

module.exports = async (req, res, next) => {
  // Allow admin actions, auth, and static files to pass
  if (req.path.startsWith('/api/admin') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/settings')) return next();

  try {
    const s = await Settings.findOne({ key: 'maintenance' });
    if (s?.value?.active) {
      return res.status(503).json({
        error: 'maintenance',
        message: s.value.message || 'We are upgrading. Please check back shortly.'
      });
    }
  } catch {}
  next();
};