export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Sanitize and trim API key (remove accidental spaces or newlines)
  const rawKey = process.env.DIDIT_API_KEY || "SQY1vXYqmLxBdpXhi3g2lpxlDYjBxX560FkSh4CVf9g";
  const DIDIT_API_KEY = (rawKey || "").trim();

  // Fast ID check workflow id
  const WORKFLOW_ID = "83d9edbe-d839-4bca-8e22-e9e02d89f537";

  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (_) {
        body = {};
      }
    }

    const { vendorData, email, name } = body || {};
    const internalUserId = vendorData || `cli_${Date.now()}`;
    const host = req.headers["x-forwarded-host"] || req.headers.host || "cleverclouds.in";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const callbackUrl = `${protocol}://${host}/?verified=true`;

    const payload = {
      workflow_id: WORKFLOW_ID,
      vendor_data: internalUserId,
      callback: callbackUrl,
      metadata: {
        brand: "Clever Clouds",
        client_name: name || undefined,
        client_email: email || undefined
      }
    };

    console.log(`[Didit API] Creating session for ${internalUserId}...`);

    const diditRes = await fetch("https://verification.didit.me/v3/session/", {
      method: "POST",
      headers: {
        "x-api-key": DIDIT_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!diditRes.ok) {
      const detail = await diditRes.text();
      console.error(`[Didit API Error] HTTP ${diditRes.status}:`, detail);
      return res.status(diditRes.status).json({
        error: "session_create_failed",
        status: diditRes.status,
        detail: detail || "Didit API returned an error"
      });
    }

    const session = await diditRes.json();
    console.log(`[Didit API Success] Session ID: ${session.session_id}`);

    return res.status(200).json({
      url: session.url,
      session_id: session.session_id,
      workflow_id: session.workflow_id,
      status: session.status || "Not Started"
    });
  } catch (err) {
    console.error("[Verify Route Exception]", err);
    return res.status(500).json({
      error: "internal_server_error",
      message: err.message
    });
  }
}
