// POST /api/opinion { program, school, kind, who }  (구버전 호환: { role } → 추진의견)
//   kind: "추진의견" | "후기"
//   who : 추진의견→주강사/보조강사/안전관리자, 후기→학생/학부모/강사
// Gemini(가성비 Flash)로 자연스러운 한국어 본문 생성. 환경변수 GEMINI_API_KEY 필수, GEMINI_MODEL 선택.
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 허용" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const program = body.program || "(미지정)";
    const school = body.school || "(미지정)";
    const kind = body.kind || "추진의견";
    const who = body.who || body.role || "주강사";

    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: "GEMINI_API_KEY 미설정" });
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const prompt =
`너는 디지털새싹 SW·AI 교육 캠프를 직접 운영하고 마무리한 현장 담당자다.
지금부터 운영 서류에 들어갈 한국어 글 한 편을 쓴다. 아래 정보와 규칙을 모두 지켜라.

[출력 형식 — 위반 시 실패로 간주]
출력은 줄바꿈 없는 평문 문단이다. 다음 문자는 결과 어디에도 절대 쓰지 않는다.
별표(*), 이중별표(**), 우물정(#), 하이픈 머리기호(- ), 가운뎃점(·), 번호 매기기(1. 2. 가. 나.), 표, 따옴표로 감싼 제목, 굵게/기울임 같은 서식.
소제목이나 라벨("작성자:", "후기:" 등)도 붙이지 않는다. 곧바로 본문 문장만 시작한다.
한 종류당 한 문단만 출력하고, 문단 앞뒤에 빈 줄이나 설명을 덧붙이지 않는다.

[어투 — 사람이 직접 쓴 글]
인공지능이 쓴 티가 나는 표현을 금지한다. 예: "AI로서", "제공된 정보에 따르면", "위 정보를 바탕으로", "결론적으로", "종합하면", "~라고 할 수 있습니다" 남발.
홍보성 과장(최고의, 혁신적인, 잊지 못할, 완벽한)과 상투어 반복(뜻깊은, 유익한, 소중한 시간)을 피한다. 같은 칭찬어를 두 번 쓰지 않는다.
구체적인 장면이나 행동을 한 가지 이상 넣어 담백하게 쓴다. 추상적 미사여구 대신 실제로 무슨 활동을 했고 학생이 어떻게 반응했는지를 적는다.
프로그램명과 학교명은 문장에 자연스럽게 한 번만 녹인다. 기계적으로 나열하거나 매 문장 반복하지 않는다.
한 문장을 너무 길게 늘이지 말고, 한글로 읽기 편하게 끊는다.

[종류별 지침]
종류가 추진의견이면 공문체로 두세 문장, 한 문단이다. 작성자 관점을 반영한다.
주강사는 수업 운영과 학생의 학습 성취 중심, 보조강사는 수업 보조와 운영 지원 중심, 안전관리자는 안전 관리와 사고 예방 중심으로 쓴다.
추진의견은 "~함", "~음", "~필요함" 같은 개조식 종결 대신, "~하였다 / ~로 판단된다 / ~권장한다" 식의 정중한 서술형 공문체를 쓴다.

종류가 후기이면 세 문장에서 다섯 문장이다.
학생은 쉬운 구어체 존댓말로 직접 겪은 느낌을 쓰고, 학부모는 정중하고 절제된 감상으로 자녀의 변화를 쓰며, 강사는 담담한 운영 소회로 현장에서 본 장면을 쓴다.

[정보]
프로그램: ${program}
학교: ${school}
종류: ${kind}
작성자: ${who}

위 정보에 맞는 글의 본문만 출력하라. 다른 말은 하지 마라.`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
        })
      }
    );
    const j = await r.json();
    if (!r.ok) return res.status(500).json({ error: (j.error && j.error.message) || `HTTP ${r.status}` });
    let text = (((j.candidates || [])[0] || {}).content || {}).parts?.[0]?.text || "";
    // 안전장치: 혹시 새어 나온 마크다운/머리기호 제거
    text = text.replace(/\*\*/g, "").replace(/^\s*[-#·*]\s*/gm, "").replace(/\s*\n\s*/g, " ").trim();
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
