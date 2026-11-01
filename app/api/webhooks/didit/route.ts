import crypto from "node:crypto";

// Whole-number floats (1.0) -> integers (1), recursively. Matches Didit's server canonicalisation.
function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shortenFloats(x)]),
    );
  }
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
  return v;
}

// Recursive lexicographic key sort (array order preserved).
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

export async function POST(req: Request) {
  const raw = await req.text();
  const sig = req.headers.get("x-signature-v2") ?? "";

  // 1. Canonicalise (shortenFloats -> sortKeys -> JSON.stringify with unescaped Unicode, the JS default).
  const parsed = JSON.parse(raw);
  const canonical = JSON.stringify(sortKeys(shortenFloats(parsed)));

  // 2. Constant-time HMAC-SHA256 compare against X-Signature-V2.
  const expected = crypto
    .createHmac("sha256", process.env.DIDIT_WEBHOOK_SECRET!)
    .update(canonical, "utf8")
    .digest("hex");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return new Response("bad sig", { status: 401 });
  }

  // 3. Freshness — check the SIGNED `parsed.timestamp` field, never the unsigned
  //    `X-Timestamp` header: the header is excluded from the HMAC, so a caller can
  //    replay a captured (body, signature) pair with a freshened header and pass.
  const ts = Number(parsed.timestamp);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
    return new Response("stale", { status: 401 });
  }

  // 4. Idempotency — dedupe on event_id (unique per delivery attempt).
  if (await alreadyProcessed(parsed.event_id)) return new Response("ok");
  await markProcessed(parsed.event_id);

  // 5. Apply the decision. Status strings are case-sensitive literals.
  switch (parsed.status) {
    case "Approved":
      await setUserVerified(parsed.vendor_data, parsed.decision);
      break;
    case "Declined":
      await setUserDeclined(parsed.vendor_data, parsed.decision);
      break;
    case "In Review":
      await setUserPendingReview(parsed.vendor_data);
      break;
    case "Resubmitted":
      await reopenNodes(parsed.vendor_data, parsed.resubmit_info?.nodes_to_resubmit);
      break;
    case "Kyc Expired":
      await markReverificationNeeded(parsed.vendor_data);
      break;
    default:
      // "Not Started" | "In Progress" | "Awaiting User" | "Abandoned" | "Expired" — log/no-op.
      break;
  }

  // 6. Return 2xx within 5 seconds. Push heavy work to a queue if needed.
  return new Response("ok");
}

// Storage helpers
const memoryEventSet = new Set<string>();
async function alreadyProcessed(id: string) {
  return memoryEventSet.has(id);
}
async function markProcessed(id: string) {
  memoryEventSet.add(id);
}
async function setUserVerified(v: string, d: unknown) {
  console.log(`[Didit KYC] User ${v} is APPROVED:`, d);
}
async function setUserDeclined(v: string, d: unknown) {
  console.warn(`[Didit KYC] User ${v} is DECLINED:`, d);
}
async function setUserPendingReview(v: string) {
  console.log(`[Didit KYC] User ${v} is IN REVIEW`);
}
async function reopenNodes(v: string, n: unknown) {
  console.log(`[Didit KYC] Nodes reopened for ${v}:`, n);
}
async function markReverificationNeeded(v: string) {
  console.warn(`[Didit KYC] Reverification needed for ${v}`);
}
