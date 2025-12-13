require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_JWT_SECRET";

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

function requireRole(roles) {
  return (req, res, next) => {
    const u = getAuthUser(req);
    if (!u) return res.status(401).json({ success: false, error: "Unauthorized" });
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
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'angajat';`);
  await pool.query(`ALTER TABLE users ALTER COLUMN status SET DEFAULT 'kyc_required';`);

  // kyc_submissions: pastram schema legacy + adaugam payload
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
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      parent_consent_path TEXT,
      parent_consent_uploaded_at TIMESTAMPTZ,
      driver_license_path TEXT,
      driver_license_uploaded_at TIMESTAMPTZ,
      criminal_record_path TEXT,
      criminal_record_uploaded_at TIMESTAMPTZ,
      payload JSONB
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
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);

  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_uploaded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_uploaded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_uploaded_at TIMESTAMPTZ;`);

  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS payload JSONB;`);

  try {
    await pool.query(`ALTER TABLE kyc_submissions ALTER COLUMN payload TYPE JSONB USING payload::jsonb;`);
  } catch (e) {
    console.error("WARN ensureSchema: cannot alter kyc_submissions.payload to JSONB:", e?.message || e);
  }

  // FIX CRITIC: daca legacy DB are NOT NULL pe id_front_path/id_back_path/selfie_path, il relaxam
  // (altfel KYC fara upload pica)
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

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ success: true, tokenUser: req.user });
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
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;`);

    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_uploaded_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_uploaded_at TIMESTAMPTZ;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_path TEXT;`);
    await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_uploaded_at TIMESTAMPTZ;`);

    // DROP NOT NULL pe coloanele care te blocheaza acum
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
// TEMP: Reset password (protejat)
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

    const ins = await pool.query(
      `INSERT INTO users(full_name,email,phone,role,status,password_hash)
       VALUES ($1,$2,$3,'angajat','kyc_required',$4)
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
      try {
        ok = await bcrypt.compare(password, String(user.password_hash));
      } catch (_) {
        ok = false;
      }
      if (!ok && String(user.password_hash) === password) ok = true;
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
// KYC submit
// ===============================
app.post("/api/kyc/submit", requireAuth, async (req, res) => {
  try {
    const raw = req.body || {};
    const payloadObj =
      raw && typeof raw === "object" && raw.payload && typeof raw.payload === "object" ? raw.payload : raw;

    const userId = Number(req.user.id);

    // email din token, fallback din DB
    let email = String(req.user.email || "").trim().toLowerCase();
    if (!email) {
      const qe = await pool.query(`SELECT email FROM users WHERE id=$1 LIMIT 1`, [userId]);
      email = qe.rowCount ? String(qe.rows[0].email || "").trim().toLowerCase() : "";
    }
    if (!email) return res.status(400).json({ success: false, error: "Cannot resolve email for user" });

    const u = await pool.query(`SELECT full_name, phone FROM users WHERE id=$1 LIMIT 1`, [userId]);
    const fullNameDb = u.rowCount ? String(u.rows[0].full_name || "").trim() : "";
    const phoneDb = u.rowCount ? String(u.rows[0].phone || "").trim() : "";

    const full_name = String(payloadObj.fullName || payloadObj.full_name || "").trim() || fullNameDb || null;
    const cnp = String(payloadObj.cnp || "").trim() || null;
    const address = String(payloadObj.address || payloadObj.adresa || "").trim() || null;
    const iban = String(payloadObj.iban || "").trim() || null;
    const phone = String(payloadObj.phone || payloadObj.telefon || "").trim() || phoneDb || null;

    const payloadJson = JSON.stringify(payloadObj || {});

    await pool.query(
      `INSERT INTO kyc_submissions
        (user_id, email, full_name, cnp, address, iban, phone, status, payload, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, NOW(), NOW())`,
      [userId, email, full_name, cnp, address, iban, phone, payloadJson]
    );

    await pool.query(`UPDATE users SET status='kyc_pending' WHERE id=$1`, [userId]);

    return res.json({
      success: true,
      message: "KYC trimis. Așteaptă aprobare admin.",
      status: "kyc_pending",
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
