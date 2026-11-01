# Clever Clouds • Client Identity Verification Portal

A dedicated, streamlined **Client Identity Verification Portal** powered by **Didit KYC (Fast ID Check)**, designed specifically for [Clever Clouds](https://www.cleverclouds.in).

---

## ⚡ What was streamlined:
- **Zero Distractions:** Removed all unnecessary marketing fluff, sample developer code tabs, and clutter.
- **Dedicated 3-Step Client Experience:**
  1. **Your Details:** Clean client intake form (Full Legal Name, Email, Reference ID) with mandatory user consent & privacy disclosure.
  2. **ID & Face Check:** Embeds Didit's live verification flow directly in the portal card (document scan + 3D facial liveness) with an "Open in separate window" option.
  3. **Confirmation:** Automatic transition to completion screen once verified.
- **Zero-Dependency Native Backend:** `server.js` is built with native Node.js (`node:http`, `node:crypto`, `fetch`). You can start it immediately with **`node server.js`** without needing `npm install`!

---

## 🚀 How to Run the Portal Live

### 1. Configure Secrets
Ensure `.env.local` contains your Didit secrets (already configured):

```bash
DIDIT_API_KEY=SQY1vXYqmLxBdpXhi3g2lpxlDYjBxX560FkSh4CVf9g
DIDIT_WEBHOOK_SECRET=<your_signing_secret_from_console>
PORT=3000
```

> **Workflow ID:** Configured in `server.js` as `83d9edbe-d839-4bca-8e22-e9e02d89f537` (*Fast ID check*).

### 2. Start the Live Server
In your terminal, simply run:

```bash
node server.js
```

Then open your browser to:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 🛡️ Endpoints Included in `server.js`

* `POST /api/verify` - Creates a Didit KYC session using `workflow_id: 83d9edbe-d839-4bca-8e22-e9e02d89f537` and returns the session `{ url, session_id }`.
* `POST /api/webhooks/didit` - Ingests signed webhooks from Didit with canonical V2 re-serialisation, constant-time HMAC-SHA256 verification against `X-Signature-V2`, and signed timestamp freshness checks.
* `GET /api/session/:id` - Real-time session status query endpoint.
