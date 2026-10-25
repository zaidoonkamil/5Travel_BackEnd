const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

/** Image uploader saving into uploads/<folder> under random names. */
function imageUpload(folder) {
  const dir = path.join(__dirname, "..", "uploads", folder);
  fs.mkdirSync(dir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = ALLOWED_TYPES.get(file.mimetype) || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 10 },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_TYPES.has(file.mimetype)) {
        return cb(Object.assign(new Error("نوع الصورة غير مدعوم (jpg, png, webp فقط)"), { statusCode: 400 }));
      }
      cb(null, true);
    },
  });
}

const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "custom");
const upload = imageUpload("custom");

module.exports = upload;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
module.exports.imageUpload = imageUpload;
