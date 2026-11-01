/**
 * Clever Clouds - Identity Verification Live Server
 * Native Node.js HTTP Server (Zero external dependencies needed)
 * Didit Protocol KYC API & Webhook Handler
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load .env or .env.local manually without external libraries
function loadEnv() {
  const envFiles = [".env.local", ".env"];
  for (const file of envFiles) {
    const fullPath = path.join(__dirname, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (e) {
        console.warn(`Could not parse ${file}:`, e.message);
      }
    }
  }
}

loadEnv();

// Default port and Didit Configuration
const PORT = process.env.PORT || 3000;
const WORKFLOW_ID = "83d9edbe-d839-4bca-8e22-e9e02d89f537"; // Fast ID check
const DIDIT_API_KEY = process.env.DIDIT_API_KEY || "SQY1vXYqmLxBdpXhi3g2lpxlDYjBxX560FkSh4CVf9g";
const DIDIT_WEBHOOK_SECRET = process.env.DIDIT_WEBHOOK_SECRET || "";

// In-memory stores
const processedEvents = new Set();
const sessionStore = new Map();

// Canonical helpers for Didit X-Signature-V2
function shortenFloats(v) {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, shortenFloats(x)])
    );
  }
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
  return v;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeys(v[k]);
        return acc;
      }, {});
  }
  return v;
}

// MIME types dictionary for static file serving
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;

  // Helper for CORS & JSON
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-signature-v2, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Collect request body
  const chunks = [];
  req.on("data", chunk => chunks.push(chunk));

  req.on("end", async () => {
    const rawBody = Buffer.concat(chunks).toString("utf8");

    // 1. POST /api/verify - Create Didit Session
    if (pathname === "/api/verify" && req.method === "POST") {
      try {
        let body = {};
        try {
          body = JSON.parse(rawBody);
        } catch (_) {}

        const vendorData = body.vendorData || `client_${Date.now()}`;
        const host = req.headers.host || `localhost:${PORT}`;
        const callbackUrl = `http://${host}/?verified=true`;

        const payload = {
          workflow_id: WORKFLOW_ID,
          vendor_data: vendorData,
          callback: callbackUrl,
          metadata: {
            brand: "Clever Clouds",
            client_name: body.name || undefined,
            client_email: body.email || undefined
          }
        };

        console.log(`[Didit] Initiating session for client: ${vendorData} (Workflow: ${WORKFLOW_ID})`);

        const diditResponse = await fetch("https://verification.didit.me/v3/session/", {
          method: "POST",
          headers: {
            "x-api-key": DIDIT_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!diditResponse.ok) {
          const detail = await diditResponse.text();
          console.error(`[Didit Error] ${diditResponse.status}:`, detail);
          res.writeHead(diditResponse.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_failed", detail }));
          return;
        }

        const session = await diditResponse.json();
        console.log(`[Didit Success] Session Created: ${session.session_id}`);

        sessionStore.set(session.session_id, {
          status: session.status || "Not Started",
          vendor_data: session.vendor_data,
          url: session.url
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          url: session.url,
          session_id: session.session_id,
          status: session.status
        }));
        return;
      } catch (err) {
        console.error("[Verify Route Exception]", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "internal_error", message: err.message }));
        return;
      }
    }

    // 2. POST /api/webhooks/didit - Signed Webhook Ingestion
    if (pathname === "/api/webhooks/didit" && req.method === "POST") {
      try {
        const sig = req.headers["x-signature-v2"] || "";
        const parsed = JSON.parse(rawBody);

        if (DIDIT_WEBHOOK_SECRET) {
          // Canonical V2 serialisation
          const canonical = JSON.stringify(sortKeys(shortenFloats(parsed)));
          const expected = crypto
            .createHmac("sha256", DIDIT_WEBHOOK_SECRET)
            .update(canonical, "utf8")
            .digest("hex");

          if (
            sig.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
          ) {
            console.error("[Webhook] Bad HMAC signature");
            res.writeHead(401);
            res.end("bad sig");
            return;
          }

          // Freshness check: ≤ 300s on signed body timestamp
          const ts = Number(parsed.timestamp);
          if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
            console.error("[Webhook] Stale timestamp");
            res.writeHead(401);
            res.end("stale");
            return;
          }

          // Idempotency: dedupe on event_id
          if (processedEvents.has(parsed.event_id)) {
            res.writeHead(200);
            res.end("ok");
            return;
          }
          processedEvents.add(parsed.event_id);
        }

        console.log(`[Webhook Event] ${parsed.webhook_type} -> Status: ${parsed.status} for ${parsed.session_id}`);

        if (parsed.session_id) {
          sessionStore.set(parsed.session_id, {
            status: parsed.status,
            vendor_data: parsed.vendor_data,
            decision: parsed.decision || null
          });
        }

        res.writeHead(200);
        res.end("ok");
        return;
      } catch (err) {
        console.error("[Webhook Exception]", err);
        res.writeHead(400);
        res.end("invalid_payload");
        return;
      }
    }

    // 3. GET /api/session/:id - Query session status
    if (pathname.startsWith("/api/session/") && req.method === "GET") {
      const sessionId = pathname.split("/").pop();
      const local = sessionStore.get(sessionId);

      // Check directly from Didit API if available
      if (sessionId && DIDIT_API_KEY) {
        try {
          const checkRes = await fetch(`https://verification.didit.me/v3/session/${sessionId}/decision/`, {
            headers: { "x-api-key": DIDIT_API_KEY }
          });
          if (checkRes.ok) {
            const decisionData = await checkRes.json();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              status: decisionData.status || (local && local.status) || "In Progress",
              session_id: sessionId,
              decision: decisionData
            }));
            return;
          }
        } catch (_) {}
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(local || { status: "In Progress", session_id: sessionId }));
      return;
    }

    // 4. Static File Serving
    let filePath = path.join(__dirname, pathname === "/" ? "index.html" : pathname);
    
    // Security check to avoid directory traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      // Fallback to index.html for single-page app
      const indexPath = path.join(__dirname, "index.html");
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🛡️  Clever Clouds Identity Verification Portal is LIVE`);
  console.log(`🌐 Portal Address: http://localhost:${PORT}`);
  console.log(`🔑 Didit Workflow ID: ${WORKFLOW_ID} (Fast ID check)`);
  console.log(`✨ Status: Ready for Client Verifications`);
  console.log(`=============================================================\n`);
});
