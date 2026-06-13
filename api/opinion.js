// POST /api/opinion { program, role, school } → Gemini(가성비 Flash)로 추진의견 생성
// 환경변수: GEMINI_API_KEY (필수), GEMINI_MODEL (선택, 기본 gemini-2.0-flash)
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 허용" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { program, role, school } = body;
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: "GEMINI_API_KEY 미설정" });
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const prompt =
      `너는 디지털새싹 SW·AI 교육 캠프 운영 서류를 돕는 한국어 보조다.\n` +
      `프로그램: ${program || "(미지정)"}\n학교: ${school || "(미지정)"}\n역할: ${role}\n\n` +
      `위 캠프에 대한 '${role}의 프로그램 추진의견'을 작성하라.\n` +
      `- 공문체, 2~3문장, 과장 없이 사실 기반\n- 머리말/제목/별표(**)/목록 기호 없이 본문만`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 400 }
        })
      }
    );
    const j = await r.json();
    if (!r.ok) return res.status(500).json({ error: (j.error && j.error.message) || `HTTP ${r.status}` });
    const text = (((j.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || "";
    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
