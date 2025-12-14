require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// multipart uploads
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());

// JSON pentru rutele care folosesc JSON
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_JWT_SECRET";

/**
 * ADMIN permanent din env (Railway Variables)
 * Exemplu value: ursache.andrei1995@gmail.com, alt@exemplu.ro
 */
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isEnvAdmin(email) {
  const e = String(email || "").trim().toLowerCase();
  return !!e && ADMIN_EMAILS.includes(e);
}

if (!process.env.DATABASE_URL) {
  console.error("ERROR: Lipseste DATABASE_URL in environment!");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Build info (ca sa confirmi ca Railway ruleaza codul nou)
const BUILD_SHA =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.RENDER_GIT_COMMIT ||
  "unknown";
const BOOT_TS = new Date().toISOString();

// ===============================
// JWT helpers
// ===============================
function signJwt(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role || "angajat",
      status: user.status || "kyc_required",
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getAuthUser(req) {
  const auth = String(req.headers.authorization || "");
  const [typ, token] = auth.split(" ");
  if (typ !== "Bearer" || !token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const u = getAuthUser(req);
  if (!u) return res.status(401).json({ success: false, error: "Unauthorized" });
  req.user = u;
  next();
}

/**
 * requireRole:
 * - permite rolurile clasice din token
 * - PLUS: dacă email-ul e în ADMIN_EMAILS => consideră admin (fără DB update)
 */
function requireRole(roles) {
  return (req, res, next) => {
    const u = getAuthUser(req);
    if (!u) return res.status(401).json({ success: false, error: "Unauthorized" });

    // Admin permanent din env
    if (isEnvAdmin(u.email)) {
      u.role = "admin";
      req.user = u;
      return next();
    }

    if (!roles.includes(u.role)) return res.status(403).json({ success: false, error: "Forbidden" });
    req.user = u;
    next();
  };
}

// ===============================
// Contract cycle helpers (Bucharest)
// ===============================
const TZ = "Europe/Bucharest";

function tzOffsetMinutes(date, timeZone) {
  const s = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).format(date);
  const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hh * 60 + mm);
}

function makeDateInTZ(y, mo1, d, h, mi, s, ms, timeZone) {
  let guessUTC = new Date(Date.UTC(y, mo1 - 1, d, h, mi, s, ms));
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(guessUTC, timeZone);
    guessUTC = new Date(Date.UTC(y, mo1 - 1, d, h, mi, s, ms) - off * 60000);
  }
  return guessUTC;
}

function getBucharestYMD(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { y: parseInt(map.year, 10), m: parseInt(map.month, 10), d: parseInt(map.day, 10) };
}

function getContractCycle(now = new Date()) {
  const { y, m, d } = getBucharestYMD(now);

  let startY = y;
  let startM = m;

  if (d < 15) {
    startM = m - 1;
    if (startM === 0) {
      startM = 12;
      startY = y - 1;
    }
  }

  let endY = startY;
  let endM = startM + 1;
  if (endM === 13) {
    endM = 1;
    endY = startY + 1;
  }

  const cycleStart = makeDateInTZ(startY, startM, 15, 0, 0, 0, 0, TZ);
  const cycleEnd = makeDateInTZ(endY, endM, 14, 23, 59, 59, 999, TZ);
  return { cycleStart, cycleEnd };
}

function addMonthsUTC(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d;
}

function isSixMonthsValid(uploadedAt) {
  if (!uploadedAt) return false;
  const exp = addMonthsUTC(new Date(uploadedAt), 6);
  return new Date() < exp;
}

// ===============================
// Uploads (local storage)
// ===============================
const UPLOAD_ROOT = path.join(__dirname, "uploads");
function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (_) {}
}
ensureDir(UPLOAD_ROOT);

function safeName(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 160);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user?.id ? String(req.user.id) : "anon";
    const dir = path.join(UPLOAD_ROOT, "kyc", userId);
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "") || "";
    const base = safeName(path.basename(file.originalname || "file", ext));
    const stamp = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, `${base}-${stamp}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const mt = String(file.mimetype || "").toLowerCase();
  if (mt.startsWith("image/") || mt === "application/pdf") return cb(null, true);
  return cb(new Error("Invalid file type"), false);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ===============================
// Schema (idempotent)
// ===============================
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'angajat',
      status TEXT NOT NULL DEFAULT 'kyc_required',
      password_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT;`);
  try { await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'angajat';`); } catch (_) {}
  try { await pool.query(`ALTER TABLE users ALTER COLUMN status SET DEFAULT 'kyc_required';`); } catch (_) {}

  // FIX: DB vechi poate avea users.created_at NOT NULL dar FARA DEFAULT => INSERT pica cu NULL
  try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;`); } catch (_) {}
  try { await pool.query(`ALTER TABLE users ALTER COLUMN created_at SET DEFAULT NOW();`); } catch (_) {}
  try { await pool.query(`UPDATE users SET created_at = NOW() WHERE created_at IS NULL;`); } catch (_) {}
  try { await pool.query(`ALTER TABLE users ALTER COLUMN created_at SET NOT NULL;`); } catch (_) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      full_name TEXT,
      cnp TEXT,
      address TEXT,
      iban TEXT,
      phone TEXT,
      id_front_path TEXT,
      id_back_path TEXT,
      selfie_path TEXT,
      parent_consent_path TEXT,
      parent_consent_uploaded_at TIMESTAMPTZ,
      driver_license_path TEXT,
      driver_license_uploaded_at TIMESTAMPTZ,
      criminal_record_path TEXT,
      criminal_record_uploaded_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS email TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS full_name TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS cnp TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS address TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS iban TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS phone TEXT;`);

  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS id_front_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS id_back_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS selfie_path TEXT;`);

  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_uploaded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_uploaded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_uploaded_at TIMESTAMPTZ;`);

  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS payload JSONB;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  // payload -> jsonb dacă a fost text
  try {
    await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN payload TYPE JSONB USING payload::jsonb;`);
  } catch (_) {}

  // relaxăm NOT NULL pe doc paths dacă unele DB-uri le au (să nu crape migrarea)
  try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN id_front_path DROP NOT NULL;`); } catch (_) {}
  try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN id_back_path DROP NOT NULL;`); } catch (_) {}
  try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN selfie_path DROP NOT NULL;`); } catch (_) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contract_acceptances (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cycle_start TIMESTAMPTZ NOT NULL,
      cycle_end TIMESTAMPTZ NOT NULL,
      contract_version TEXT NOT NULL,
      contract_text_hash TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      accepted_ip TEXT,
      accepted_user_agent TEXT
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_contract_acceptances_user_cycle
    ON contract_acceptances(user_id, cycle_start, cycle_end);
  `);
}

// ===============================
// Health / debug
// ===============================
app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    ts: new Date().toISOString(),
    bootTs: BOOT_TS,
    build: BUILD_SHA,
  })
);

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    if (!userId) return res.status(401).json({ success: false, error: "Unauthorized" });

    const q = await pool.query(
      `SELECT id, full_name, email, phone, role, status
       FROM users
       WHERE id=$1
       LIMIT 1`,
      [userId]
    );

    if (!q.rowCount) return res.status(404).json({ success: false, error: "User not found" });

    const dbUser = q.rows[0];

    // admin permanent din env
    if (isEnvAdmin(dbUser.email)) dbUser.role = "admin";

    const freshToken = signJwt(dbUser);

    return res.json({ success: true, tokenUser: dbUser, token: freshToken });
  } catch (e) {
    console.error("ERROR /api/auth/me:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// ADMIN: migrate (protejat cu RESET_PASSWORD_SECRET)
// ===============================
app.post("/api/admin/migrate", async (req, res) => {
  try {
    const secret = String(req.body?.secret || "");

    if (!process.env.RESET_PASSWORD_SECRET) {
      return res.status(500).json({ success: false, error: "RESET_PASSWORD_SECRET not set" });
    }
    if (secret !== process.env.RESET_PASSWORD_SECRET) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS payload JSONB;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS email TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS full_name TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS cnp TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS address TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS iban TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS phone TEXT;`);

    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS id_front_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS id_back_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS selfie_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_uploaded_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_uploaded_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_uploaded_at TIMESTAMPTZ;`);

    try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN id_front_path DROP NOT NULL;`); } catch (_) {}
    try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN id_back_path DROP NOT NULL;`); } catch (_) {}
    try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN selfie_path DROP NOT NULL;`); } catch (_) {}
    try { await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN payload TYPE JSONB USING payload::jsonb;`); } catch (_) {}

    return res.json({ success: true, message: "migrate_ok" });
  } catch (e) {
    console.error("ERROR /api/admin/migrate:", e);
    return res.status(500).json({ success: false, error: "Eroare internă.", detail: String(e?.message || e) });
  }
});

// ===============================
// ADMIN: Reset password (protejat cu RESET_PASSWORD_SECRET)
// ===============================
app.post("/api/admin/reset-password", async (req, res) => {
  try {
    const secret = String(req.body?.secret || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const newPassword = String(req.body?.newPassword || "");

    if (!process.env.RESET_PASSWORD_SECRET) {
      return res.status(500).json({ success: false, error: "RESET_PASSWORD_SECRET not set" });
    }
    if (secret !== process.env.RESET_PASSWORD_SECRET) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (!email || !newPassword) {
      return res.status(400).json({ success: false, error: "Missing email/newPassword" });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    const upd = await pool.query(
      `UPDATE users
       SET password_hash=$1
       WHERE LOWER(email)=LOWER($2)
       RETURNING id, email`,
      [hash, email]
    );

    if (!upd.rowCount) return res.status(404).json({ success: false, error: "User not found" });
    return res.json({ success: true, user: upd.rows[0] });
  } catch (e) {
    console.error("ERROR /api/admin/reset-password:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// ADMIN: Set role (protejat cu RESET_PASSWORD_SECRET)
// ===============================
app.post("/api/admin/set-role", async (req, res) => {
  try {
    const secret = String(req.body?.secret || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "").trim();

    if (!process.env.RESET_PASSWORD_SECRET) {
      return res.status(500).json({ success: false, error: "RESET_PASSWORD_SECRET not set" });
    }
    if (secret !== process.env.RESET_PASSWORD_SECRET) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (!email || !role) return res.status(400).json({ success: false, error: "Missing email/role" });

    const upd = await pool.query(
      `UPDATE users SET role=$1 WHERE LOWER(email)=LOWER($2) RETURNING id, email, role, status`,
      [role, email]
    );
    if (!upd.rowCount) return res.status(404).json({ success: false, error: "User not found" });

    return res.json({ success: true, user: upd.rows[0] });
  } catch (e) {
    console.error("ERROR /api/admin/set-role:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// ADMIN: Set status (protejat cu RESET_PASSWORD_SECRET)
// ===============================
app.post("/api/admin/set-status", async (req, res) => {
  try {
    const secret = String(req.body?.secret || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    const status = String(req.body?.status || "").trim();

    if (!process.env.RESET_PASSWORD_SECRET) {
      return res.status(500).json({ success: false, error: "RESET_PASSWORD_SECRET not set" });
    }
    if (secret !== process.env.RESET_PASSWORD_SECRET) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    if (!email || !status) return res.status(400).json({ success: false, error: "Missing email/status" });

    const upd = await pool.query(
      `UPDATE users SET status=$1 WHERE LOWER(email)=LOWER($2) RETURNING id, email, role, status`,
      [status, email]
    );
    if (!upd.rowCount) return res.status(404).json({ success: false, error: "User not found" });

    return res.json({ success: true, user: upd.rows[0] });
  } catch (e) {
    console.error("ERROR /api/admin/set-status:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// AUTH
// ===============================
app.post("/api/auth/register", async (req, res) => {
  try {
    const full_name = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const password = String(req.body?.password || "");

    if (!full_name || !email || !phone || !password) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }

    const exists = await pool.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (exists.rowCount) return res.status(409).json({ success: false, error: "Email already exists" });

    const password_hash = await bcrypt.hash(password, 10);

    // FIX: includem created_at explicit ca sa nu pice pe DB-uri vechi fara DEFAULT pe created_at
    const ins = await pool.query(
      `INSERT INTO users(full_name,email,phone,role,status,password_hash,created_at)
       VALUES ($1,$2,$3,'angajat','kyc_required',$4,NOW())
       RETURNING id, full_name, email, phone, role, status`,
      [full_name, email, phone, password_hash]
    );

    return res.status(201).json({ success: true, user: ins.rows[0] });
  } catch (e) {
    console.error("ERROR /api/auth/register:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Missing email/password" });
    }

    const q = await pool.query(
      `SELECT id, full_name, email, phone, role, status, password_hash
       FROM users
       WHERE LOWER(email)=LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (!q.rowCount) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const user = q.rows[0];

    let ok = false;
    if (user.password_hash) {
      try { ok = await bcrypt.compare(password, String(user.password_hash)); } catch (_) { ok = false; }
      if (!ok && String(user.password_hash) === password) ok = true; // legacy fallback
    }

    if (!ok) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const token = signJwt(user);

    return res.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
      token,
    });
  } catch (e) {
    console.error("ERROR /api/auth/login:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// KYC submit (multipart)
// ===============================
app.post(
  "/api/kyc/submit",
  requireAuth,
  upload.fields([
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
    { name: "parentConsent", maxCount: 1 },
    { name: "license", maxCount: 1 },
    { name: "record", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = Number(req.user.id);
      const tokenEmail = String(req.user.email || "").trim().toLowerCase();

      const body = req.body || {};
      const email = tokenEmail || String(body.email || "").trim().toLowerCase();

      const cnp = String(body.cnp || body.CNP || "").trim();
      const address = String(body.address || "").trim();

      // FIX IBAN (NU MAI LASA NULL)
      const iban = String(body.iban || body.IBAN || "").trim(); // poate fi "", dar NU va fi NULL

      const isDriver = String(body.isDriver || "0") === "1";
      const aiDataConfirmed = String(body.aiDataConfirmed || "0") === "1";

      const fullNameFromBody = String(body.fullName || body.full_name || "").trim();

      const uq = await pool.query(
        `SELECT id, full_name, email, phone
         FROM users
         WHERE id=$1
         LIMIT 1`,
        [userId]
      );
      if (!uq.rowCount) return res.status(404).json({ success: false, error: "User not found" });

      const dbUser = uq.rows[0];
      const full_name = fullNameFromBody || String(dbUser.full_name || "").trim();
      const phone = String(dbUser.phone || "").trim();

      if (!cnp) {
        return res.status(400).json({
          success: false,
          error: "CNP lipsă în request. Frontend trebuie să trimită `cnp` în FormData.",
        });
      }

      const files = req.files || {};
      const f = (name) => (files && files[name] && files[name][0]) ? files[name][0] : null;

      const idFront = f("idFront");
      const idBack = f("idBack");
      const selfie = f("selfie");
      const parentConsent = f("parentConsent");
      const license = f("license");
      const record = f("record");

      if (!idFront || !idBack || !selfie) {
        return res.status(400).json({
          success: false,
          error: "Lipsesc fișiere obligatorii: idFront, idBack, selfie.",
        });
      }

      const payload = {
        email,
        fullName: full_name,
        cnp,
        address,
        iban,
        isDriver,
        aiDataConfirmed,
        rawBodyKeys: Object.keys(body || {}),
        files: {
          idFront: { path: idFront.path, original: idFront.originalname, mimetype: idFront.mimetype, size: idFront.size },
          idBack: { path: idBack.path, original: idBack.originalname, mimetype: idBack.mimetype, size: idBack.size },
          selfie: { path: selfie.path, original: selfie.originalname, mimetype: selfie.mimetype, size: selfie.size },
          parentConsent: parentConsent ? { path: parentConsent.path, original: parentConsent.originalname, mimetype: parentConsent.mimetype, size: parentConsent.size } : null,
          license: license ? { path: license.path, original: license.originalname, mimetype: license.mimetype, size: license.size } : null,
          record: record ? { path: record.path, original: record.originalname, mimetype: record.mimetype, size: record.size } : null,
        },
      };

      await pool.query(
        `INSERT INTO kyc_submissions(
           user_id, email, full_name, cnp, address, iban, phone,
           id_front_path, id_back_path, selfie_path,
           parent_consent_path, parent_consent_uploaded_at,
           driver_license_path, driver_license_uploaded_at,
           criminal_record_path, criminal_record_uploaded_at,
           status, payload, created_at, updated_at
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,
           $8,$9,$10,
           $11,$12,
           $13,$14,
           $15,$16,
           'pending',$17,NOW(),NOW()
         )`,
        [
          userId,
          email,
          full_name,
          cnp,
          address || null,
          iban || "",
          phone || null,
          idFront.path,
          idBack.path,
          selfie.path,
          parentConsent ? parentConsent.path : null,
          parentConsent ? new Date().toISOString() : null,
          license ? license.path : null,
          license ? new Date().toISOString() : null,
          record ? record.path : null,
          record ? new Date().toISOString() : null,
          payload,
        ]
      );

      await pool.query(`UPDATE users SET status='pending' WHERE id=$1`, [userId]);

      return res.json({
        success: true,
        message: "KYC trimis. Așteaptă aprobare admin.",
        status: "pending",
      });
    } catch (e) {
      console.error("ERROR /api/kyc/submit:", e);
      return res.status(500).json({
        success: false,
        error: String(e?.message || e),
        code: e?.code || null,
        detail: e?.detail || null,
        constraint: e?.constraint || null,
      });
    }
  }
);

// KYC doc-status
app.get("/api/kyc/doc-status", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: "Missing email" });

    const u = await pool.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (!u.rowCount) return res.status(404).json({ success: false, error: "User not found" });

    const userId = u.rows[0].id;

    const q = await pool.query(
      `SELECT parent_consent_path, parent_consent_uploaded_at,
              driver_license_path, driver_license_uploaded_at,
              criminal_record_path, criminal_record_uploaded_at
       FROM kyc_submissions
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    const row = q.rowCount ? q.rows[0] : null;
    const recordValid = row && row.criminal_record_uploaded_at ? isSixMonthsValid(row.criminal_record_uploaded_at) : false;

    return res.json({
      success: true,
      parentConsent:
        row && row.parent_consent_path
          ? { path: row.parent_consent_path, uploadedAt: row.parent_consent_uploaded_at }
          : null,
      driver: {
        license:
          row && row.driver_license_path
            ? { path: row.driver_license_path, uploadedAt: row.driver_license_uploaded_at }
            : null,
        record:
          row && row.criminal_record_path
            ? { path: row.criminal_record_path, uploadedAt: row.criminal_record_uploaded_at, valid: recordValid }
            : null,
      },
    });
  } catch (e) {
    console.error("ERROR /api/kyc/doc-status:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// ADMIN KYC
// ===============================
app.get("/api/admin/kyc/list", requireRole(["admin"]), async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT
          k.id AS kyc_id,
          k.user_id,
          k.status AS kyc_status,
          k.created_at,
          k.updated_at,
          k.email AS kyc_email,
          k.full_name AS kyc_full_name,
          k.cnp,
          k.address,
          k.iban,
          k.phone AS kyc_phone,
          k.id_front_path,
          k.id_back_path,
          k.selfie_path,
          k.parent_consent_path,
          k.driver_license_path,
          k.criminal_record_path,
          k.payload,
          u.full_name,
          u.email,
          u.phone,
          u.role,
          u.status AS user_status
       FROM kyc_submissions k
       JOIN users u ON u.id = k.user_id
       WHERE k.status='pending'
       ORDER BY k.created_at ASC`
    );

    return res.json({ success: true, pending: q.rows });
  } catch (e) {
    console.error("ERROR /api/admin/kyc/list:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/admin/kyc/approve", requireRole(["admin"]), async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    if (!userId) return res.status(400).json({ success: false, error: "Missing user_id" });

    await pool.query(
      `UPDATE kyc_submissions SET status='approved', updated_at=NOW()
       WHERE user_id=$1 AND status='pending'`,
      [userId]
    );
    await pool.query(`UPDATE users SET status='approved' WHERE id=$1`, [userId]);

    return res.json({ success: true, message: "KYC approved", status: "approved" });
  } catch (e) {
    console.error("ERROR /api/admin/kyc/approve:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/admin/kyc/reject", requireRole(["admin"]), async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    const reason = String(req.body?.reason || "").trim();
    if (!userId) return res.status(400).json({ success: false, error: "Missing user_id" });

    await pool.query(
      `UPDATE kyc_submissions SET status='rejected', updated_at=NOW()
       WHERE user_id=$1 AND status='pending'`,
      [userId]
    );
    await pool.query(`UPDATE users SET status='rejected' WHERE id=$1`, [userId]);

    return res.json({ success: true, message: "KYC rejected", status: "rejected", reason: reason || null });
  } catch (e) {
    console.error("ERROR /api/admin/kyc/reject:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// CONTRACT
// ===============================
app.get("/api/contract/status", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: "Missing email" });

    const u = await pool.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (!u.rowCount) return res.status(404).json({ success: false, error: "User not found" });

    const userId = u.rows[0].id;
    const { cycleStart, cycleEnd } = getContractCycle(new Date());

    const a = await pool.query(
      `SELECT id FROM contract_acceptances
       WHERE user_id=$1 AND cycle_start=$2 AND cycle_end=$3
       LIMIT 1`,
      [userId, cycleStart.toISOString(), cycleEnd.toISOString()]
    );

    return res.json({
      success: true,
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
      acceptedForCycle: !!a.rowCount,
    });
  } catch (e) {
    console.error("ERROR /api/contract/status:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/contract/accept", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const contractVersion = String(req.body?.contractVersion || "").trim();
    const contractTextHash = String(req.body?.contractTextHash || "").trim();

    if (!email || !contractVersion || !contractTextHash) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }

    const u = await pool.query(`SELECT id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email]);
    if (!u.rowCount) return res.status(404).json({ success: false, error: "User not found" });

    const userId = u.rows[0].id;
    const { cycleStart, cycleEnd } = getContractCycle(new Date());

    const ip =
      (req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : "") ||
      (req.socket && req.socket.remoteAddress) ||
      null;

    const ua = req.headers["user-agent"] ? String(req.headers["user-agent"]) : null;

    await pool.query(
      `INSERT INTO contract_acceptances(
          user_id, cycle_start, cycle_end, contract_version, contract_text_hash, accepted_ip, accepted_user_agent
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, cycle_start, cycle_end) DO UPDATE
       SET contract_version=EXCLUDED.contract_version,
           contract_text_hash=EXCLUDED.contract_text_hash,
           accepted_at=NOW(),
           accepted_ip=EXCLUDED.accepted_ip,
           accepted_user_agent=EXCLUDED.accepted_user_agent`,
      [userId, cycleStart.toISOString(), cycleEnd.toISOString(), contractVersion, contractTextHash, ip, ua]
    );

    return res.json({ success: true, cycleStart: cycleStart.toISOString(), cycleEnd: cycleEnd.toISOString() });
  } catch (e) {
    console.error("ERROR /api/contract/accept:", e);
    return res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// ===============================
// Start
// ===============================
(async () => {
  try {
    await ensureSchema();
    app.listen(PORT, () => console.log(`REAL backend running on port ${PORT}`));
  } catch (e) {
    console.error("ensureSchema error:", e.message || e);
    app.listen(PORT, () => console.log(`REAL backend running on port ${PORT} (schema may not be ready)`));
  }
})();
