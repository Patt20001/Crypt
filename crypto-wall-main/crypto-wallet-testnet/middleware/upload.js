const multer = require('multer');
const path = require('path');
const fs = require('fs');

const baseDir = path.join(__dirname, '..', 'public', 'uploads');
const kycDir = path.join(baseDir, 'kyc');
const selfieDir = path.join(baseDir, 'selfies');

if (!fs.existsSync(kycDir)) fs.mkdirSync(kycDir, { recursive: true });
if (!fs.existsSync(selfieDir)) fs.mkdirSync(selfieDir, { recursive: true });

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
const ALLOWED_IMAGE_ONLY = ['.jpg', '.jpeg', '.png', '.webp'];

function makeUpload(dir, allowedExts) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${req.user._id}-${Date.now()}${ext}`);
      }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedExts.includes(ext)) return cb(new Error('Invalid file type'));
      cb(null, true);
    }
  });
}

module.exports = {
  kycUpload: makeUpload(kycDir, ALLOWED),
  selfieUpload: makeUpload(selfieDir, ALLOWED_IMAGE_ONLY),
  kycDir,
  selfieDir
};