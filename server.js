app.post("/api/kyc/submit", requireAuth, async (req, res) => {
  try {
    // Acceptă ambele forme:
    // 1) { payload: {...} }
    // 2) { fullName, cnp, ... } (root)
    const raw = req.body || {};
    const payloadObj =
      raw && typeof raw === "object" && raw.payload && typeof raw.payload === "object"
        ? raw.payload
        : raw;

    const userId = Number(req.user.id);

    // IMPORTANT: pentru Postgres JSONB, trimite ca string JSON și castează ::jsonb
    const payloadJson = JSON.stringify(payloadObj || {});

    await pool.query(
      `INSERT INTO kyc_submissions(user_id, status, payload)
       VALUES ($1, 'pending', $2::jsonb)`,
      [userId, payloadJson]
    );

    await pool.query(
      `UPDATE users SET status='kyc_pending' WHERE id=$1`,
      [userId]
    );

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
    });
  }
});
