"use strict";

const express = require("express");

const BOOT_TS = new Date().toISOString();
const BUILD =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.BUILD ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  null;

const app = express();
app.disable("x-powered-by");

// CORS + preflight
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-SP-AI-PROXY"
  );
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// JSON body
app.use(express.json({ limit: "1mb" }));

// JSON parse error -> JSON response (nu HTML)
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ success: false, error: "Invalid JSON" });
  }
  return next(err);
});

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString(), bootTs: BOOT_TS, build: BUILD });
});

// Helper: lock doar pe /api/ai (nu omorî serverul)
function checkProxySecret(req) {
  const expected = (process.env.AI_PROXY_SECRET || "").trim();

  // dacă secretul nu e setat în Railway, nu crăpăm; doar refuzăm endpoint-ul
  if (!expected) {
    return { ok: false, code: 503, error: "AI_PROXY_SECRET missing in Railway Variables." };
  }

  const got = (req.get("x-sp-ai-proxy") || "").trim();
  if (!got || got !== expected) {
    return { ok: false, code: 403, error: "Forbidden (proxy secret invalid)." };
  }

  return { ok: true };
}

// Core endpoint
app.post("/api/ai", async (req, res) => {
  const action = (req.body && req.body.action) || "diagnostic";
  const actor = (req.body && req.body.actor) || null;

  // diagnostic e util și fără secret (dar dacă vrei strict proxy-only, lasă și diagnostic sub lock)
  // Eu îl las sub lock ca să fie "proxy only" 100%.
  const gate = checkProxySecret(req);
  if (!gate.ok) {
    return res.status(gate.code).json({
      success: false,
      ok: false,
      ai: "sp-ai-railway",
      error: gate.error,
      time: Date.now(),
    });
  }

  if (action === "diagnostic") {
    const hasOpenAIKey = Boolean((process.env.OPENAI_API_KEY || "").trim());
    const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

    return res.json({
      success: true,
      ai: "sp-ai-railway",
      ok: true,
      hasOpenAIKey,
      model,
      build: BUILD,
      bootTs: BOOT_TS,
      time: Date.now(),
      actorRole: actor && actor.role ? actor.role : null,
      note: hasOpenAIKey
        ? "OpenAI key present. POST /api/ai ready."
        : "OPENAI_API_KEY missing in Railway Variables.",
    });
  }

  if (action === "chat") {
    const key = (process.env.OPENAI_API_KEY || "").trim();
    if (!key) {
      return res.status(500).json({
        success: false,
        ok: false,
        ai: "sp-ai-railway",
        error: "OPENAI_API_KEY missing in Railway Variables.",
        time: Date.now(),
      });
    }

    const messages = Array.isArray(req.body.messages) ? req.body.messages : [];
    if (!messages.length) {
      return res.status(400).json({ success: false, error: "messages[] required" });
    }

    const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
    const temperature =
      typeof req.body.temperature === "number" ? req.body.temperature : 0.2;

    // Chat Completions (compat)
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature }),
    });

    let data = null;
    try {
      data = await upstream.json();
    } catch (_) {}

    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        ok: false,
        ai: "sp-ai-railway",
        error: "OpenAI upstream error",
        status: upstream.status,
        body: data,
        time: Date.now(),
      });
    }

    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || "")
      : "";

    return res.json({
      success: true,
      ai: "sp-ai-railway",
      ok: true,
      model,
      text,
      usage: data.usage || null,
      time: Date.now(),
    });
  }

  return res.status(400).json({ success: false, error: "Unknown action" });
});

// Start
const PORT = Number(process.env.PORT || "3000");
app.listen(PORT, () => {
  console.log("sp-ai listening on", PORT, "bootTs=", BOOT_TS, "build=", BUILD);
});
