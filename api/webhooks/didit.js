import crypto from "node:crypto";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const DIDIT_WEBHOOK_SECRET = process.env.DIDIT_WEBHOOK_SECRET || "a1EphjUD7sY5fYnhBLhsdFsVC6B1s9GsmtT6jmtgLLs";

  try {
    const sig = req.headers["x-signature-v2"] || "";
    const body = req.body;

    if (DIDIT_WEBHOOK_SECRET) {
      const canonical = JSON.stringify(sortKeys(shortenFloats(body)));
      const expected = crypto
        .createHmac("sha256", DIDIT_WEBHOOK_SECRET)
        .update(canonical, "utf8")
        .digest("hex");

      if (
        sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
      ) {
        return res.status(401).send("bad sig");
      }

      const ts = Number(body.timestamp);
      if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
        return res.status(401).send("stale");
      }
    }

    console.log(`[Webhook Ingested] ${body.webhook_type} -> ${body.status} for session ${body.session_id}`);

    return res.status(200).send("ok");
  } catch (err) {
    console.error("[Webhook Error]", err);
    return res.status(400).send("invalid_payload");
  }
}
