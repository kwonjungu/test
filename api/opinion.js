// POST /api/opinion { program, school, kind, who }  (구버전 호환: { role } → 추진의견)
//   kind: "추진의견" | "후기"  /  who: 주강사·보조강사·안전관리자 | 학생·학부모·강사
// Gemini(가성비 Flash)로 자연스러운 한국어 본문 생성.
// 하네스: 모델 폴백 체인 + 타임아웃 + 응답 검증 + 마크다운/AI어투 후처리.
// 환경변수: GEMINI_API_KEY(필수), GEMINI_MODEL(선택, 우선 시도)

// 단종 대비 폴백 순서 (공식 안정 모델 → 별칭). 앞에서부터 시도.
const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"];

function buildPrompt({ program, school, kind, who }) {
  return `너는 디지털새싹 SW·AI 교육 캠프를 직접 운영하고 마무리한 현장 담당자다.
지금부터 운영 서류에 들어갈 한국어 글 한 편을 쓴다. 아래 정보와 규칙을 모두 지켜라.

[출력 형식 — 위반 시 실패로 간주]
출력은 줄바꿈 없는 평문 문단이다. 다음 문자는 결과 어디에도 절대 쓰지 않는다.
별표(*), 이중별표(**), 우물정(#), 하이픈 머리기호(- ), 가운뎃점(·), 번호 매기기(1. 2. 가. 나.), 표, 따옴표로 감싼 제목, 굵게/기울임 같은 서식.
소제목이나 라벨("작성자:", "후기:" 등)도 붙이지 않는다. 곧바로 본문 문장만 시작한다.
한 종류당 한 문단만 출력하고, 문단 앞뒤에 빈 줄이나 설명을 덧붙이지 않는다.

[사실성 — 엄수]
올해는 2026년이다. 연도·인원·수치 등 사실을 임의로 지어내지 않는다.
학교명·기관명·지역명은 본문에 절대 쓰지 않는다(예: 00초등학교, 디지털새싹 베이스캠프 같은 표현 금지). 특정 학교를 언급하지 말고, 프로그램(교안) 활동 내용 중심으로만 쓴다.
프로그램은 반드시 아래 정보의 프로그램만 다룬다. 다른 캠프명·프로그램명을 새로 만들지 않는다.
프로그램 주제와 무관한 소재(예: 파이썬, 특정 게임 제목 등 교안에 없는 것)를 만들어 넣지 않는다. 프로그램명에서 드러나는 주제 범위 안에서만 쓴다.

[어투 — 사람이 직접 쓴 글]
인공지능이 쓴 티가 나는 표현을 금지한다. 예: "AI로서", "제공된 정보에 따르면", "위 정보를 바탕으로", "결론적으로", "종합하면", "~라고 할 수 있습니다" 남발.
홍보성 과장(최고의, 혁신적인, 잊지 못할, 완벽한)과 상투어 반복(뜻깊은, 유익한, 소중한 시간)을 피한다. 같은 칭찬어를 두 번 쓰지 않는다.
구체적인 장면이나 행동을 한 가지 이상 넣어 담백하게 쓴다. 추상적 미사여구 대신 실제로 무슨 활동을 했고 학생이 어떻게 반응했는지를 적는다.
프로그램(교안)의 활동·주제를 문장에 자연스럽게 녹인다. 기계적으로 나열하지 않는다.
한 문장을 너무 길게 늘이지 말고, 한글로 읽기 편하게 끊는다.

[종류별 지침]
종류가 추진의견이면 공문체로 두세 문장, 한 문단이다. 작성자 관점을 반영한다.
주강사는 수업 운영과 학생의 학습 성취 중심, 보조강사는 수업 보조와 운영 지원 중심, 안전관리자는 안전 관리와 사고 예방 중심으로 쓴다.
추진의견은 "~함", "~음" 같은 개조식 종결 대신 "~하였다 / ~로 판단된다 / ~권장한다" 식 정중한 서술형 공문체를 쓴다.

종류가 후기이면 세 문장에서 다섯 문장이다.
학생은 쉬운 구어체 존댓말, 학부모는 정중하고 절제된 감상, 강사는 담담한 운영 소회로 쓴다.

[정보]
프로그램(교안): ${program}
종류: ${kind}
작성자: ${who}

위 프로그램(교안) 내용에 맞는 글의 본문만 출력하라. 학교명은 쓰지 마라. 다른 말은 하지 마라.`;
}

function cleanText(t) {
  return (t || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-#·*]\s+/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

// 한 모델 1회 호출 (타임아웃 포함). { ok, text } 또는 { ok:false, status, msg, retriable }
async function callModel(model, prompt, key, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget:0 → 2.5계열의 사고 토큰이 출력예산을 먹어 본문이 잘리는 문제 방지
          generationConfig: { temperature: 0.8, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } }
        }),
        signal: ctrl.signal
      }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
      // 모델 문제(단종/없음)면 다음 모델로 폴백, 그 외(키/쿼터)는 재시도 의미 없음
      const modelGone = r.status === 404 || /no longer available|not found|not supported|deprecat/i.test(msg);
      const retriable = modelGone || r.status === 429 || r.status >= 500;
      return { ok: false, status: r.status, msg, retriable, modelGone };
    }
    const cand = (j.candidates || [])[0] || {};
    const text = cleanText((cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text) || "");
    if (!text) {
      const block = (j.promptFeedback && j.promptFeedback.blockReason) || cand.finishReason || "빈 응답";
      return { ok: false, status: 200, msg: `생성 결과 없음(${block})`, retriable: true };
    }
    return { ok: true, text, model };
  } catch (e) {
    const aborted = e && e.name === "AbortError";
    return { ok: false, status: 0, msg: aborted ? "응답 시간 초과" : String(e && e.message || e), retriable: true };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST 만 허용" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const data = {
      program: body.program || "(미지정)",
      school: body.school || "(미지정)",
      kind: body.kind || "추진의견",
      who: body.who || body.role || "주강사"
    };
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(500).json({ error: "GEMINI_API_KEY 미설정 (Vercel 환경변수)" });

    // 모델 폴백 체인 (중복 제거)
    const models = [];
    for (const m of [process.env.GEMINI_MODEL, ...DEFAULT_MODELS]) {
      if (m && !models.includes(m)) models.push(m);
    }

    const prompt = buildPrompt(data);
    const errors = [];
    for (const model of models) {
      let attempt = await callModel(model, prompt, key);
      if (!attempt.ok && attempt.retriable && !attempt.modelGone) {
        attempt = await callModel(model, prompt, key);   // 일시 오류 1회 재시도(같은 모델)
      }
      if (attempt.ok) return res.status(200).json({ text: attempt.text, model: attempt.model });
      errors.push(`${model}: ${attempt.msg}`);
      if (!attempt.retriable) break;   // 키/쿼터 등 → 폴백 무의미
    }
    return res.status(502).json({ error: `생성 실패 — ${errors.join(" | ")}` });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message || e) });
  }
};
