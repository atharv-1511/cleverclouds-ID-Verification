export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { id } = req.query;
  const DIDIT_API_KEY = process.env.DIDIT_API_KEY || "SQY1vXYqmLxBdpXhi3g2lpxlDYjBxX560FkSh4CVf9g";

  if (!id) {
    return res.status(400).json({ error: "missing_id" });
  }

  try {
    const diditRes = await fetch(`https://verification.didit.me/v3/session/${id}/decision/`, {
      headers: { "x-api-key": DIDIT_API_KEY }
    });

    if (diditRes.ok) {
      const data = await diditRes.json();
      return res.status(200).json({
        status: data.status || "In Progress",
        session_id: id,
        decision: data
      });
    }

    return res.status(200).json({ status: "In Progress", session_id: id });
  } catch (err) {
    return res.status(200).json({ status: "In Progress", session_id: id });
  }
}
