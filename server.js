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
// Body JSON: { email: string, action: "approve" | "reject" }
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
