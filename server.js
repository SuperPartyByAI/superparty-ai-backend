require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// Railway: PORT este obligatoriu. Local: cade pe 8090.
const PORT = Number(process.env.PORT || 8090);

// IMPORTANT: pune JWT_SECRET în Railway Variables
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_JWT_SECRET";

// DB
if (!process.env.DATABASE_URL) {
  console.error("ERROR: Lipseste DATABASE_URL in environment!");
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =========================================
// Helpers: JWT
// =========================================
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

// =========================================
// Helpers: Contract cycle (Bucharest)
// =========================================
const TZ = "Europe/Bucharest";

function tzOffsetMinutes(date, timeZone) {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).format(date);
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
  return {
    y: parseInt(map.year, 10),
    m: parseInt(map.month, 10),
    d: parseInt(map.day, 10),
  };
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

// =========================================
// Schema (safe idempotent)
// =========================================
async function ensureSchema() {
  // users (minimal pentru auth)
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

  // kyc_submissions (minimal + câmpuri doc)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      parent_consent_path TEXT,
      parent_consent_uploaded_at TIMESTAMPTZ,
      driver_license_path TEXT,
      driver_license_uploaded_at TIMESTAMPTZ,
      criminal_record_path TEXT,
      criminal_record_uploaded_at TIMESTAMPTZ
    );
  `);

  // contract_acceptances
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

  // ALTER idempotent (dacă tabelul exista deja)
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS parent_consent_uploaded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS driver_license_uploaded_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_path TEXT;`);
  await pool.query(`ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS criminal_record_uploaded_at TIMESTAMPTZ;`);
}

// =========================================
// Health
// =========================================
app.get("/health", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

app.get("/health-contract", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
});

// =========================================
// AUTH (REAL) — asta îți rezolvă token: null
// =========================================
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

    res.status(201).json({ success: true, user: ins.rows[0] });
  } catch (e) {
    console.error("ERROR /api/auth/register:", e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Missing email/password" });
    }

    const u = await pool.query(
      `SELECT id, full_name, email, phone, role, status, password_hash
       FROM users
       WHERE LOWER(email)=LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (!u.rowCount) return res.status(401).json({ success: false, error: "Invalid credentials" });

    const user = u.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ success: false, error: "Invalid credentials" });

    // AICI e fix-ul: token NU mai e null
    const token = signJwt(user);

    res.json({
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
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// =========================================
// KYC submit (set status -> kyc_pending)
// =========================================
app.post("/api/kyc/submit", requireAuth, async (req, res) => {
  try {
    const payload = req.body?.payload ?? {};
    const userId = Number(req.user.id);

    // insert submission
    await pool.query(
      `INSERT INTO kyc_submissions(user_id,status,payload) VALUES ($1,'pending',$2)`,
      [userId, payload]
    );

    // update user status
    await pool.query(`UPDATE users SET status='kyc_pending' WHERE id=$1`, [userId]);

    res.json({ success: true, message: "KYC trimis. Așteaptă aprobare admin.", status: "kyc_pending" });
  } catch (e) {
    console.error("ERROR /api/kyc/submit:", e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// KYC doc status (minor + sofer + cazier valid 6 luni)
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

    res.json({
      success: true,
      parentConsent: row && row.parent_consent_path
        ? { path: row.parent_consent_path, uploadedAt: row.parent_consent_uploaded_at }
        : null,
      driver: {
        license: row && row.driver_license_path
          ? { path: row.driver_license_path, uploadedAt: row.driver_license_uploaded_at }
          : null,
        record: row && row.criminal_record_path
          ? { path: row.criminal_record_path, uploadedAt: row.criminal_record_uploaded_at, valid: recordValid }
          : null
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// =========================================
// ADMIN KYC
// =========================================
app.get("/api/admin/kyc/list", requireRole(["admin"]), async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT k.id AS kyc_id, k.user_id, k.status AS kyc_status, k.created_at,
              u.full_name, u.email, u.phone, u.role, u.status AS user_status,
              k.payload
       FROM kyc_submissions k
       JOIN users u ON u.id = k.user_id
       WHERE k.status='pending'
       ORDER BY k.created_at ASC`
    );

    res.json({ success: true, pending: q.rows });
  } catch (e) {
    console.error("ERROR /api/admin/kyc/list:", e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/admin/kyc/approve", requireRole(["admin"]), async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    if (!userId) return res.status(400).json({ success: false, error: "Missing user_id" });

    await pool.query(`UPDATE kyc_submissions SET status='approved' WHERE user_id=$1 AND status='pending'`, [userId]);
    await pool.query(`UPDATE users SET status='approved' WHERE id=$1`, [userId]);

    res.json({ success: true, message: "KYC approved", status: "approved" });
  } catch (e) {
    console.error("ERROR /api/admin/kyc/approve:", e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

app.post("/api/admin/kyc/reject", requireRole(["admin"]), async (req, res) => {
  try {
    const userId = Number(req.body?.user_id);
    const reason = String(req.body?.reason || "").trim();
    if (!userId) return res.status(400).json({ success: false, error: "Missing user_id" });

    await pool.query(`UPDATE kyc_submissions SET status='rejected' WHERE user_id=$1 AND status='pending'`, [userId]);
    await pool.query(`UPDATE users SET status='rejected' WHERE id=$1`, [userId]);

    res.json({ success: true, message: "KYC rejected", status: "rejected", reason: reason || null });
  } catch (e) {
    console.error("ERROR /api/admin/kyc/reject:", e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// =========================================
// CONTRACT status/accept (păstrat)
// =========================================
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

    res.json({
      success: true,
      cycleStart: cycleStart.toISOString(),
      cycleEnd: cycleEnd.toISOString(),
      acceptedForCycle: !!a.rowCount,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Eroare internă." });
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
      `INSERT INTO contract_acceptances(user_id, cycle_start, cycle_end, contract_version, contract_text_hash, accepted_ip, accepted_user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, cycle_start, cycle_end) DO UPDATE
       SET contract_version=EXCLUDED.contract_version,
           contract_text_hash=EXCLUDED.contract_text_hash,
           accepted_at=NOW(),
           accepted_ip=EXCLUDED.accepted_ip,
           accepted_user_agent=EXCLUDED.accepted_user_agent`,
      [userId, cycleStart.toISOString(), cycleEnd.toISOString(), contractVersion, contractTextHash, ip, ua]
    );

    res.json({ success: true, cycleStart: cycleStart.toISOString(), cycleEnd: cycleEnd.toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Eroare internă." });
  }
});

// =========================================
// Start
// =========================================
ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`REAL backend running on port ${PORT}`));
  })
  .catch((e) => {
    console.error("ensureSchema error:", e);
    app.listen(PORT, () => console.log(`REAL backend running on port ${PORT} (schema may not be ready)`));
  });
