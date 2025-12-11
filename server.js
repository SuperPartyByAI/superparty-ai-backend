require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Verificăm că avem DATABASE_URL
if (!process.env.DATABASE_URL) {
  console.error("ERROR: Lipseste DATABASE_URL in environment!");
  process.exit(1);
}

// Pool Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : false,
});

// === Configurare upload fișiere KYC ===
const kycUploadDir = path.join(__dirname, "uploads", "kyc");
fs.mkdirSync(kycUploadDir, { recursive: true });

const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, kycUploadDir);
  },
  filename: (req, file, cb) => {
    const email = (req.body.email || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(file.originalname || "");
    const field = file.fieldname;
    const ts = Date.now();
    cb(null, `${email}_${field}_${ts}${ext}`);
  },
});

const kycUpload = multer({ storage: kycStorage });

// Helperi pentru parole (fără bcrypt, folosim crypto built-in)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;

    const hashedBuffer = crypto.scryptSync(password, salt, 64);
    const hashBuffer = Buffer.from(hash, "hex");

    if (hashedBuffer.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(hashedBuffer, hashBuffer);
  } catch {
    return false;
  }
}

// Funcție pentru inițializarea tabelelor + aliniere coloane
async function initDb() {
  const createUsersSql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'angajat',
      status TEXT NOT NULL DEFAULT 'pending_admin',
      kyc_status TEXT NOT NULL DEFAULT 'not_started',
      is_approved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  const createKycSql = `
    CREATE TABLE IF NOT EXISTS kyc_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      full_name TEXT NOT NULL,
      cnp TEXT NOT NULL,
      address TEXT NOT NULL,
      iban TEXT NOT NULL,
      phone TEXT NOT NULL,
      id_front_path TEXT NOT NULL,
      id_back_path TEXT NOT NULL,
      selfie_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  // Cream tabelele daca nu exista
  await pool.query(createUsersSql);
  await pool.query(createKycSql);

  // Aliniem structura users
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'angajat';
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_admin';
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'not_started';
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  // Aliniem structura kyc_submissions
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS cnp TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS iban TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS id_front_path TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS id_back_path TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS selfie_path TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);
  await pool.query(`
    ALTER TABLE kyc_submissions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
  `);

  console.log("Tabelele 'users' și 'kyc_submissions' sunt pregătite și aliniate.");
}

// Healthcheck
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Healthcheck DB error:", err);
    res.status(500).json({ status: "error", error: "DB connection error" });
  }
});

// DEBUG: verificăm coloanele din tabela users
app.get("/api/debug/users-columns", async (req, res) => {
  try {
    const sql = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position;
    `;
    const result = await pool.query(sql);
    res.json({ success: true, columns: result.rows });
  } catch (err) {
    console.error("ERROR /api/debug/users-columns:", err);
    res.status(500).json({
      success: false,
      error: "Eroare la citirea coloanelor users",
      details: err.message,
      code: err.code || null,
    });
  }
});

// Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body || {};

    if (!fullName || !email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Lipsesc numele, emailul sau parola." });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, error: "Există deja un cont cu acest email." });
    }

    const passwordHash = hashPassword(password);
    const now = new Date();

    const insertSql = `
      INSERT INTO users
        (full_name, email, phone, password_hash, role, status, kyc_status, is_approved, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, full_name, email, phone, role, status, kyc_status, is_approved, created_at, updated_at
    `;

    const values = [
      fullName,
      email,
      phone || null,
      passwordHash,
      "angajat",
      "pending_admin",
      "not_started",
      false,
      now,
      now,
    ];

    const result = await pool.query(insertSql, values);
    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      user,
      message: "Cont creat cu succes. Așteaptă aprobarea unui admin.",
    });
  } catch (err) {
    console.error("ERROR /api/auth/register:", err);
    return res.status(500).json({
      success: false,
      error: "Eroare internă de server.",
      details: err.message,
      code: err.code || null,
    });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, error: "Lipsesc emailul sau parola." });
    }

    const selectSql = `
      SELECT id, full_name, email, phone, password_hash, role, status, kyc_status, is_approved
      FROM users
      WHERE email = $1
      LIMIT 1
    `;

    const result = await pool.query(selectSql, [email]);
    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, error: "Email sau parolă incorecte." });
    }

    const user = result.rows[0];

    const isMatch = verifyPassword(password, user.password_hash);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, error: "Email sau parolă incorecte." });
    }

    delete user.password_hash;

    return res.json({
      success: true,
      user,
      token: null,
    });
  } catch (err) {
    console.error("ERROR /api/auth/login:", err);
    return res.status(500).json({
      success: false,
      error: "Eroare internă de server.",
      details: err.message,
      code: err.code || null,
    });
  }
});

// === KYC: status ===
app.get("/api/kyc/status", async (req, res) => {
  try {
    const email = (req.query.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Lipsește parametrul email.",
      });
    }

    const userResult = await pool.query(
      "SELECT id, kyc_status FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Utilizator inexistent.",
      });
    }

    const user = userResult.rows[0];

    const kycResult = await pool.query(
      `
        SELECT status
        FROM kyc_submissions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [user.id]
    );

    if (kycResult.rows.length === 0) {
      const status =
        user.kyc_status === "approved" ||
        user.kyc_status === "pending" ||
        user.kyc_status === "rejected"
          ? user.kyc_status
          : "none";

      return res.json({
        success: true,
        status,
      });
    }

    return res.json({
      success: true,
      status: kycResult.rows[0].status,
    });
  } catch (err) {
    console.error("ERROR /api/kyc/status:", err);
    return res.status(500).json({
      success: false,
      error: "Eroare internă de server KYC.",
      details: err.message,
      code: err.code || null,
    });
  }
});

// === KYC: submit ===
app.post(
  "/api/kyc/submit",
  kycUpload.fields([
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
    { name: "selfie", maxCount: 1 },
    { name: "contractSigned", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const body = req.body || {};
      const files = req.files || {};

      const {
        email,
        fullName,
        cnp,
        address,
        iban,
        phone,
        status: frontendStatus,
        kyc_status: frontendKycStatus,
      } = body;

      if (!email || !fullName || !cnp || !address || !iban || !phone) {
        return res.status(400).json({
          success: false,
          error:
            "Lipsesc câmpuri obligatorii: email, fullName, cnp, address, iban sau phone.",
        });
      }

      if (
        !files.idFront ||
        !files.idFront[0] ||
        !files.idBack ||
        !files.idBack[0] ||
        !files.selfie ||
        !files.selfie[0]
      ) {
        return res.status(400).json({
          success: false,
          error: "Lipsesc pozele (față, verso buletin sau selfie).",
        });
      }

      const idFrontPath = files.idFront[0].path;
      const idBackPath = files.idBack[0].path;
      const selfiePath = files.selfie[0].path;
      const contractPath =
        files.contractSigned && files.contractSigned[0]
          ? files.contractSigned[0].path
          : null;

      const userResult = await pool.query(
        "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
        [email]
      );

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Utilizator inexistent.",
        });
      }

      const userId = userResult.rows[0].id;
      const now = new Date();

      const insertKycSql = `
        INSERT INTO kyc_submissions
          (user_id, email, full_name, cnp, address, iban, phone,
           id_front_path, id_back_path, selfie_path, status, created_at, updated_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, status
      `;

      const kycResult = await pool.query(insertKycSql, [
        userId,
        email,
        fullName,
        cnp,
        address,
        iban,
        phone,
        idFrontPath,
        idBackPath,
        selfiePath,
        "pending",
        now,
        now,
      ]);

      await pool.query(
        "UPDATE users SET kyc_status = $1, updated_at = $2 WHERE id = $3",
        ["pending", now, userId]
      );

      console.log("KYC submission stored for:", email);
      console.log(
        "Fișiere primite:",
        Object.keys(files)
          .map((k) => `${k}(${files[k].length})`)
          .join(", ")
      );

      return res.json({
        success: true,
        status: kycResult.rows[0].status,
        message: "KYC trimis cu succes. Status: pending.",
      });
    } catch (err) {
      console.error("ERROR /api/kyc/submit:", err);
      return res.status(500).json({
        success: false,
        error: "Eroare internă de server la KYC submit.",
        details: err.message,
        code: err.code || null,
      });
    }
  }
);

// === ADMIN: listează KYC pending ===
app.get("/api/admin/kyc/list", async (req, res) => {
  try {
    const statusFilter = (req.query.status || "pending").toLowerCase();

    const result = await pool.query(
      `
        SELECT
          k.id,
          k.user_id,
          k.email,
          k.full_name,
          k.cnp,
          k.address,
          k.iban,
          k.phone,
          k.id_front_path,
          k.id_back_path,
          k.selfie_path,
          k.status AS kyc_status,
          k.created_at,
          k.updated_at,
          u.status AS user_status,
          u.kyc_status AS user_kyc_status,
          u.is_approved
        FROM kyc_submissions k
        JOIN users u ON u.id = k.user_id
        WHERE k.status = $1
        ORDER BY k.created_at DESC
      `,
      [statusFilter]
    );

    return res.json({
      success: true,
      items: result.rows,
    });
  } catch (err) {
    console.error("ERROR /api/admin/kyc/list:", err);
    return res.status(500).json({
      success: false,
      error: "Eroare internă la listarea KYC.",
      details: err.message,
    });
  }
});

// === ADMIN: approve / reject KYC ===
app.post("/api/admin/kyc/approve", async (req, res) => {
  try {
    const { email, action } = req.body || {};

    if (!email || !action) {
      return res.status(400).json({
        success: false,
        error: "Lipsesc email sau action.",
      });
    }

    const normalizedAction = action.toLowerCase();
    if (!["approve", "reject"].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        error: "action trebuie să fie 'approve' sau 'reject'.",
      });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Utilizator inexistent.",
      });
    }

    const userId = userResult.rows[0].id;
    const now = new Date();

    const kycResult = await pool.query(
      `
        SELECT id
        FROM kyc_submissions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [userId]
    );

    if (kycResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Nu există nicio cerere KYC pentru acest utilizator.",
      });
    }

    const kycId = kycResult.rows[0].id;

    if (normalizedAction === "approve") {
      await pool.query(
        "UPDATE users SET status = $1, kyc_status = $2, is_approved = $3, updated_at = $4 WHERE id = $5",
        ["active", "approved", true, now, userId]
      );

      await pool.query(
        "UPDATE kyc_submissions SET status = $1, updated_at = $2 WHERE id = $3",
        ["approved", now, kycId]
      );

      return res.json({
        success: true,
        action: "approve",
        message: `KYC aprobat pentru ${email}.`,
      });
    }

    if (normalizedAction === "reject") {
      await pool.query(
        "UPDATE users SET kyc_status = $1, updated_at = $2 WHERE id = $3",
        ["rejected", now, userId]
      );

      await pool.query(
        "UPDATE kyc_submissions SET status = $1, updated_at = $2 WHERE id = $3",
        ["rejected", now, kycId]
      );

      return res.json({
        success: true,
        action: "reject",
        message: `KYC respins pentru ${email}.`,
      });
    }
  } catch (err) {
    console.error("/api/admin/kyc/approve ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "Eroare internă la approve/reject KYC.",
      details: err.message,
    });
  }
});

const PORT = process.env.PORT || 8080;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SuperParty backend running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Eroare la initDb:", err);
    process.exit(1);
  });
