// 로컬 문구 은행 — API 호출 없이 추진의견/후기를 생성한다.
// data/opinion-bank.json 에 (프로그램 id × 종류 × 작성자)별로 "서로 다른 사람이
// 쓴 것처럼" 목소리가 제각각인 완결 변형본이 대량 비축돼 있고, 여기서 무작위로 뽑는다.
//
// 은행 스키마:
//   { [id]: { "추진의견": { 주강사:[...], 보조강사:[...], 안전관리자:[...] },
//             "후기":     { 학생:[...], 학부모:[...], 강사:[...] } } }
//
// 매칭 실패(은행에 없는 프로그램/조합)면 null → 호출부가 Gemini(경량) 폴백.

const { programId } = require("./program-context");

let BANK = {};
try {
  // 정적 require — Vercel 번들에 포함되도록 (fs.readdir 지양)
  BANK = require("../data/opinion-bank.json");
} catch {
  BANK = {};
}

// 종류/작성자 표기 흔들림 흡수 (구버전 role 호환 포함)
function normKind(kind) {
  const k = (kind || "").toString().trim();
  if (/후기|소감|리뷰/.test(k)) return "후기";
  return "추진의견";
}
function normWho(who, kind) {
  const w = (who || "").toString().trim();
  if (normKind(kind) === "후기") {
    if (/학생|학습자|아이/.test(w)) return "학생";
    if (/학부모|보호자|부모/.test(w)) return "학부모";
    return "강사";
  }
  if (/보조/.test(w)) return "보조강사";
  if (/안전/.test(w)) return "안전관리자";
  return "주강사";
}

// 문서 안전 후처리 — 서식문자·줄바꿈 제거 (opinion.js 의 cleanText 와 동일 규칙)
function clean(t) {
  return (t || "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[-#·*]\s+/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// 특정 조합에 준비된 변형본 개수 (진단·테스트용)
function bankCount(id, kind, who) {
  const arr = BANK[id] && BANK[id][normKind(kind)] && BANK[id][normKind(kind)][normWho(who, kind)];
  return Array.isArray(arr) ? arr.length : 0;
}

// 핵심: 프로그램·종류·작성자로 완결 변형본 1개를 무작위로. 없으면 null.
function localOpinion(program, kind, who) {
  const id = programId(program);
  if (!id) return null;
  const k = normKind(kind);
  const w = normWho(who, kind);
  const arr = BANK[id] && BANK[id][k] && BANK[id][k][w];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const pick = arr[Math.floor(Math.random() * arr.length)];
  const text = clean(pick);
  return text || null;
}

module.exports = { localOpinion, bankCount, BANK };
