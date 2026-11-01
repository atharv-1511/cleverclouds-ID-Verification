import { NextResponse } from "next/server";

// Per-session config, NOT a secret and NOT an env var.
// Fast ID check workflow id
const WORKFLOW_ID = "83d9edbe-d839-4bca-8e22-e9e02d89f537";

export async function POST(req: Request) {
  try {
    // Identify the user from YOUR auth/session — never trust an id sent from the browser blindly.
    const { vendorData } = await req.json().catch(() => ({ vendorData: undefined }));

    const res = await fetch("https://verification.didit.me/v3/session/", {
      method: "POST",
      headers: {
        "x-api-key": process.env.DIDIT_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_id: WORKFLOW_ID,
        vendor_data: vendorData ?? `user_${Date.now()}`, // your stable internal user id
        callback: "https://cleverclouds.in/verify/done", // where Didit returns the user after the flow
      }),
    });

    if (!res.ok) {
      // 403 => missing/invalid/revoked x-api-key. Body: {"detail":"You do not have permission to perform this action."}
      const detail = await res.text();
      return NextResponse.json({ error: "session_create_failed", detail }, { status: 502 });
    }

    const session = await res.json(); // { session_id, session_token, url, status, workflow_id, vendor_data }
    // Return ONLY what the client needs. session_token is for native SDKs; url is for web/iframe/redirect.
    return NextResponse.json({ url: session.url, session_id: session.session_id });
  } catch (err: any) {
    return NextResponse.json({ error: "internal_error", message: err.message }, { status: 500 });
  }
}
