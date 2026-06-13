// GET /api/load?code=...  → Firestore camps/{code} 읽기
const db = require("./_firebase");

module.exports = async (req, res) => {
  try {
    const code = String((req.query && req.query.code) || "").trim().toLowerCase();
    if (!code) return res.status(400).json({ error: "code 가 필요합니다" });

    const doc = await db.collection("camps").doc(code).get();
    if (!doc.exists) return res.status(404).json({ error: "해당 코드 없음" });
    return res.status(200).json(doc.data());
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
