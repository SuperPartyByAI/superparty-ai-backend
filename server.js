import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: false },
};

function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS (dacă ai deja în proiect altă logică, păstreaz-o pe aia)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  const AI_RAILWAY_URL = process.env.AI_RAILWAY_URL || "";

  // GET: diagnostic simplu
  if (req.method === "GET") {
    return res.status(200).json({
      success: true,
      ai: "sp-ai-proxy",
      ok: true,
      note: "Use POST /api/ai. Proxy target set by AI_RAILWAY_URL.",
      hasTarget: !!AI_RAILWAY_URL,
      time: Date.now(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }

  // Citește raw body și parsează controlat (ca să nu mai vezi HTML 400)
  const raw = await readRawBody(req);
  let body: any = null;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return res.status(400).json({ success: false, error: "Invalid JSON" });
  }

  if (!AI_RAILWAY_URL) {
    return res.status(200).json({
      success: true,
      ai: "sp-ai-v0",
      ok: true,
      note: "AI_RAILWAY_URL missing in Vercel env. Set it to enable proxy to Railway.",
      actorRole: body?.actor?.role || null,
      time: Date.now(),
    });
  }

  // Forward către Railway
  const url = `${AI_RAILWAY_URL.replace(/\/+$/, "")}/api/ai?dbg=${Date.now()}`;
  const rr = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const txt = await rr.text();
  res.status(rr.status);
  res.setHeader("Content-Type", rr.headers.get("content-type") || "application/json; charset=utf-8");
  return res.send(txt);
}
