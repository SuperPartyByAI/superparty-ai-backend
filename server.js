// server.js - SuperParty backend (CommonJS)

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change_this_in_env";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("ERROR: Lipseste DATABASE_URL in environment!");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();

// ====== MIDDLEWARE ======
app.use(express.json());

app.use(
  cors({
    origin: "*", // poți restricționa mai târziu la domeniile tale
    credentials: false,
  })
);

// ====== HEALTHCHECK ======
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Helper JWT
function createToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

// =============================
// 🔵 REGISTER
// =============================
app.post("/api/auth/register", async (req, res) => {
  try {
    const { fullName, email, phone, password } = req.body || {};

    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        error: "Te rog completează toate câmpurile.",
      });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Email already exists.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `
      INSERT INTO users (full_name, email, phone, password_hash, role, kyc_status, is_approved)
      VALUES ($1, $2, $3, $4, 'angajat', 'required', FALSE)
      RETURNING id, full_name, email, role, kyc_status, is_approved
      `,
      [fullName, email.toLowerCase(), phone, passwordHash]
    );

    const user = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "User created and pending approval.",
      user: {
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        kycStatus: user.kyc_status,
        isApproved: user.is_approved,
      },
    });
  } catch (err) {
    console.error("ERROR /api/auth/register", err);
    res.status(500).json({
      success: false,
      error: "Eroare internă de server.",
    });
  }
});

// =============================
// 🔵 LOGIN
// =============================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Lipsesc emailul sau parola.",
      });
    }

    const result = await pool.query(
      `
      SELECT id, full_name, email, phone, password_hash, role, kyc_status, is_approved
      FROM users
      WHERE email = $1 LIMIT 1
      `,
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Email sau parolă incorecte.",
      });
    }

    const user = result.rows[0];

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        error: "Email sau parolă incorecte.",
      });
    }

    const token = createToken(user);

    return res.json({
      success: true,
      token,
      user: {
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        kycStatus: user.kyc_status,
        isApproved: user.is_approved,
      },
    });
  } catch (err) {
    console.error("ERROR /api/auth/login", err);
    res.status(500).json({
      success: false,
      error: "Eroare internă de server.",
    });
  }
});

// =============================
// PORNIRE SERVER
// =============================
app.listen(PORT, () => {
  console.log(`SuperParty backend running on port ${PORT}`);
});
