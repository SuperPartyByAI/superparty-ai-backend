// ===============================
// AI (PROXY-LOCKED)  POST /api/ai
// ===============================
app.post("/api/ai", async (req, res) => {
  try {
    // 1) Hard lock: accept only requests coming from Vercel proxy
    const expected = String(process.env.AI_PROXY_SECRET || "").trim();
    const got = String(req.headers["x-sp-ai-proxy"] || "").trim();

    if (!expected) {
      return res.status(500).json({ success: false, error: "AI_PROXY_SECRET not set" });
    }
    if (got !== expected) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    // 2) Parse input
    const body = req.body || {};
    const action = String(body.action || "").trim();

    const actorRole = String(body.actor?.role || "").trim() || null;
    const model = String(body.model || "gpt-4o-mini").trim();

    // 3) Diagnostic
    if (action === "diagnostic") {
      return res.json({
        success: true,
        ai: "sp-ai-railway",
        ok: true,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        model,
        build: BUILD_SHA,
        bootTs: BOOT_TS,
        time: Date.now(),
        actorRole,
        note: process.env.OPENAI_API_KEY
          ? "OpenAI key present. POST /api/ai ready."
          : "OPENAI_API_KEY missing in Railway Variables.",
      });
    }

    // 4) Chat
    if (action !== "chat") {
      return res.status(400).json({ success: false, error: "Unknown action" });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ success: false, error: "OPENAI_API_KEY missing" });
    }

    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const messages = msgs
      .map((m) => ({
        role: String(m?.role || "user"),
        content: String(m?.content || ""),
      }))
      .filter((m) => m.content && m.content.trim().length > 0)
      .slice(-30);

    if (!messages.length) {
      return res.status(400).json({ success: false, error: "Missing messages" });
    }

    const temperature =
      typeof body.temperature === "number" && Number.isFinite(body.temperature)
        ? body.temperature
        : 0.2;

    // 5) OpenAI call (no extra deps; Node 22 has fetch)
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + String(process.env.OPENAI_API_KEY),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature }),
    });

    const raw = await r.text();
    if (!r.ok) {
      return res.status(502).json({
        success: false,
        error: "OpenAI error",
        status: r.status,
        body: raw.slice(0, 800),
      });
    }

    let j = null;
    try {
      j = JSON.parse(raw);
    } catch {
      return res.status(502).json({ success: false, error: "Invalid OpenAI JSON", body: raw.slice(0, 800) });
    }

    const text =
      j?.choices?.[0]?.message?.content != null ? String(j.choices[0].message.content) : "";

    return res.json({
      success: true,
      ai: "sp-ai-railway",
      ok: true,
      model,
      text,
      usage: j.usage || null,
      time: Date.now(),
    });
  } catch (e) {
    console.error("ERROR /api/ai:", e);
    return res.status(500).json({ success: false, error: "Eroare internă.", detail: String(e?.message || e) });
  }
});
