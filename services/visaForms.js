const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { badRequest } = require("./httpError");

// ---------------- Form definition (admin) ----------------

const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "phone", "email", "image", "file"];
const UPLOAD_TYPES = new Set(["image", "file"]);
const MAX_FIELDS = 40;

const isUpload = (field) => UPLOAD_TYPES.has(field.type);

/** Cleans the admin's field list: labels required, unique keys, options only for select. */
function normalizeFields(raw) {
  let list = raw;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list || "[]");
    } catch (_) {
      throw badRequest("صيغة الحقول غير صحيحة");
    }
  }
  if (!Array.isArray(list)) throw badRequest("صيغة الحقول غير صحيحة");
  if (list.length > MAX_FIELDS) throw badRequest(`الحد الأقصى ${MAX_FIELDS} حقل`);

  const keys = new Set();
  return list.map((item, i) => {
    const label = String(item?.label ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!label) throw badRequest(`اسم الحقل رقم ${i + 1} مطلوب`);
    const type = FIELD_TYPES.includes(item?.type) ? item.type : "text";

    let key = String(item?.key ?? "").trim();
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || keys.has(key)) key = `f_${crypto.randomBytes(4).toString("hex")}`;
    keys.add(key);

    const field = { key, label, type, required: item?.required !== false && item?.required !== "false" };
    const hint = String(item?.hint ?? "").trim().slice(0, 200);
    if (hint) field.hint = hint;
    if (type === "select") {
      const options = (Array.isArray(item?.options) ? item.options : [])
        .map((o) => String(o).trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 30);
      if (options.length < 2) throw badRequest(`الحقل «${label}» يحتاج خيارين على الأقل`);
      field.options = [...new Set(options)];
    }
    if (isUpload(field)) field.multiple = item?.multiple === true || item?.multiple === "true";
    return field;
  });
}

// ---------------- Answers (customer) ----------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAnswers(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (_) {
    throw badRequest("صيغة البيانات غير صحيحة");
  }
}

/**
 * Validates text answers against the form; only the form's own keys are kept.
 * Upload fields are checked separately against the files (see checkFiles).
 */
function validateAnswers(fields, raw) {
  const input = parseAnswers(raw);
  const answers = {};
  for (const field of fields) {
    if (isUpload(field)) continue;
    const value = String(input[field.key] ?? "").trim().slice(0, field.type === "textarea" ? 3000 : 300);
    if (!value) {
      if (field.required) throw badRequest(`«${field.label}» مطلوب`, { param: field.key });
      continue;
    }
    const bad = (message) => badRequest(`«${field.label}»: ${message}`, { param: field.key });
    if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) throw bad("أدخل رقماً");
    if (field.type === "date" && (!DATE_RE.test(value) || Number.isNaN(Date.parse(value)))) throw bad("تاريخ غير صحيح");
    if (field.type === "email" && !EMAIL_RE.test(value)) throw bad("بريد إلكتروني غير صحيح");
    if (field.type === "phone" && !/^\+?[\d\s-]{6,20}$/.test(value)) throw bad("رقم هاتف غير صحيح");
    if (field.type === "select" && !field.options.includes(value)) throw bad("اختر من القائمة");
    answers[field.key] = value;
  }
  return answers;
}

// ---------------- Private files ----------------

// Passports and documents: never under the public /uploads, only through signed links.
const PRIVATE_DIR = path.join(__dirname, "..", "private_uploads", "visa");
fs.mkdirSync(PRIVATE_DIR, { recursive: true });

const DOC_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
]);
const MAX_FILES_PER_FIELD = 5;

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PRIVATE_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${DOC_TYPES.get(file.mimetype) || ""}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 40 },
  fileFilter: (req, file, cb) => {
    if (!DOC_TYPES.has(file.mimetype)) {
      return cb(Object.assign(new Error("نوع الملف غير مدعوم (صور أو PDF فقط)"), { statusCode: 400 }));
    }
    cb(null, true);
  },
});

const fileInfo = (f) => ({
  file: f.filename,
  name: String(f.originalname || f.filename).slice(0, 150),
  mime: f.mimetype,
  size: f.size,
});

function removeStored(files) {
  for (const f of files || []) {
    const name = typeof f === "string" ? f : f.file || f.filename;
    if (!name || name.includes("/") || name.includes("\\")) continue;
    fs.promises.unlink(path.join(PRIVATE_DIR, name)).catch(() => {});
  }
}

/**
 * Groups the uploaded files by field (form name "file_<key>") and merges them with the ones
 * kept from before. Checks types, counts and required fields; unknown uploads are deleted.
 */
function collectFiles(fields, uploaded, kept = {}) {
  const byField = {};
  const stray = [];
  for (const f of uploaded || []) {
    const key = String(f.fieldname || "").replace(/^file_/, "");
    const field = fields.find((x) => x.key === key && isUpload(x));
    if (!field || (field.type === "image" && !f.mimetype.startsWith("image/"))) {
      stray.push(f);
      continue;
    }
    (byField[key] ||= []).push(fileInfo(f));
  }
  removeStored(stray);

  const result = {};
  for (const field of fields.filter(isUpload)) {
    const list = [...(kept[field.key] || []), ...(byField[field.key] || [])];
    const limit = field.multiple ? MAX_FILES_PER_FIELD : 1;
    if (list.length > limit) {
      throw badRequest(`«${field.label}»: الحد الأقصى ${limit} ${limit === 1 ? "ملف" : "ملفات"}`, { param: field.key });
    }
    if (field.required && list.length === 0) throw badRequest(`«${field.label}» مطلوب`, { param: field.key });
    if (list.length) result[field.key] = list;
  }
  return result;
}

// ---------------- Signed links ----------------

const LINK_TTL_SECONDS = 60 * 60;

function signature(applicationId, file, exp) {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(`visa:${applicationId}:${file}:${exp}`)
    .digest("base64url");
}

function publicBase(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

/** A link to one stored file that works for an hour, for <img> tags and downloads. */
function signedUrl(req, applicationId, file) {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
  const sig = signature(applicationId, file, exp);
  return `${publicBase(req)}/visa-files/${applicationId}/${encodeURIComponent(file)}?exp=${exp}&sig=${sig}`;
}

function verifySignature(applicationId, file, exp, sig) {
  if (!/^\d+$/.test(String(exp)) || Number(exp) < Date.now() / 1000) return false;
  const expected = Buffer.from(signature(applicationId, file, exp));
  const given = Buffer.from(String(sig || ""));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = {
  FIELD_TYPES,
  isUpload,
  normalizeFields,
  validateAnswers,
  documentUpload,
  collectFiles,
  fileInfo,
  removeStored,
  signedUrl,
  verifySignature,
  PRIVATE_DIR,
};
