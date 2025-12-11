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
    const email = (req.body.email || "unknown").replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
    const ext = path.extname(file.originalname || "");
    const field = file.fieldname;
    const ts = Date.now();
    cb(null, `${email}_${field}_${ts}${ext}`);
  },
});

const kycUpload = multer({ storage: kycStorage });

// Helperi pentru parole (fără bcrypt, doar crypto built-in)
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

// Funcție pentru inițializarea tabelelor
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
      status TEXT NOT NULL DEFAULT 'pending', -- pending / approved / rejected
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  await pool.query(createUsersSql);
  await pool.query(createKycSql);

  console.log("Tabelele 'users' și 'kyc_submissions' sunt pregătite.");
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

    // Verificăm dacă există deja
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
      status: kycResult.rows[0].status, // pending / approved / rejected
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
// compatibil cu frontend-ul tău: câmpuri text + fișiere (idFront, idBack, selfie, contractSigned)
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

      // Validare câmpuri text obligatorii
      if (!email || !fullName || !cnp || !address || !iban || !phone) {
        return res.status(400).json({
          success: false,
          error:
            "Lipsesc câmpuri obligatorii: email, fullName, cnp, address, iban sau phone.",
        });
      }

      // Validare fișiere obligatorii
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

      // contractSigned e optional pentru backend (dar în UI e required)
      const idFrontPath = files.idFront[0].path;
      const idBackPath = files.idBack[0].path;
      const selfiePath = files.selfie[0].path;
      // lăsăm contractul doar pe disk, fără să-l băgăm acum în DB
      const contractPath =
        files.contractSigned && files.contractSigned[0]
          ? files.contractSigned[0].path
          : null;

      // Căutăm user-ul
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

      // Inserăm KYC nou în kyc_submissions
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

      // Updatăm users.kyc_status = 'pending'
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
