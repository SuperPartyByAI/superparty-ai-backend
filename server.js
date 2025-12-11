require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

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

// Funcție pentru inițializarea tabelei users
async function initDb() {
  const createTableSql = `
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

  await pool.query(createTableSql);
  console.log("Tabela 'users' este pregătită.");
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

    const passwordHash = await bcrypt.hash(password, 10);
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
    const isMatch = await bcrypt.compare(password, user.password_hash);

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