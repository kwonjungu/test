// POST /api/save  { code, data }  → Firestore camps/{code} 에 저장
const db = require("./_firebase");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 허용" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { code, data } = body;
    const id = String(code || "").trim().toLowerCase().replace(/[^a-z0-9가-힣_-]/g, "");
    if (!id) return res.status(400).json({ error: "유효한 코드가 필요합니다" });
    if (!data) return res.status(400).json({ error: "data 가 필요합니다" });

    await db.collection("camps").doc(id).set({ data, updatedAt: Date.now() });
    return res.status(200).json({ ok: true, code: id });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
