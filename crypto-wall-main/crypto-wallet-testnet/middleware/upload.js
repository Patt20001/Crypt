const multer = require('multer');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, '..', 'public', 'uploads', 'kyc');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${req.user._id}-${Date.now()}${ext}`;
    cb(null, name);
  }
});

const ALLOWED = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED.includes(ext)) return cb(new Error('Only JPG, PNG, WEBP, or PDF allowed'));
    cb(null, true);
  }
});

module.exports = upload;