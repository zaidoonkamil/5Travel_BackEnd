const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "custom");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_TYPES.get(file.mimetype) || ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(Object.assign(new Error("نوع الصورة غير مدعوم (jpg, png, webp فقط)"), { statusCode: 400 }));
    }
    cb(null, true);
  },
});

module.exports = upload;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
