import { RegionResolver, SIDO_LIST } from "./region.js?v=26";
import {
  parseRoster, toRegistrationRows, buildRegistrationXlsx,
  defaultChasi, defaultChasiForProgram, fmtDate, parseSchedule, programCore
} from "./convert.js?v=26";
import { buildReceiptHwpx, buildEquipmentLedgerHwpx, buildReportHwpx, buildSafetyLogHwpx, buildChecklistHwpx, buildPayApplicationHwpx, buildSafetyPayHwpx, buildSafetyContractHwpx, buildMulticulturalConfirmHwpx, buildCaseBookHwpx, buildSafetyPledgeHwpx } from "./hwpx.js?v=26";
import { buildGachonEquipHwpx, buildGachonMealHwpx, buildGachonMaterialHwpx, buildGachonReportHwpx, buildGachonLectureHwpx, buildGachonWorkHwpx, buildGachonBanner } from "./hwpx_gachon.js?v=26";
import { NEIS_API_KEY } from "./config.js?v=26";

const $ = (id) => document.getElementById(id);
const resolver = new RegionResolver();
resolver.neisKey = NEIS_API_KEY;

// 기관별 프로파일 — 진입 게이트에서 선택. 프로그램 목록·템플릿 경로가 기관마다 다름.
const ORG_PROFILES = {
  "대림대학교": {
    short: "대림대",
    tplBase: "templates/",
    programs: [
      "(기본/초저) 노벨엔지니어링으로 만드는 안전한 등굣길",
      "(기본/초저) Eco 모빌리티, 멈춰버린 도시를 구하라!",
      "(기본/초고) 이동의 권리를 보장하는 배리어프리 레이스",
      "(기본/고등) AI로 꿈꾸는 Auto 디자인 스튜디오",
      "(AI특화/초고) 로봇이 그리는 로-그-인 스마트시티",
      "(특화/다문화) 드론 모빌리티, 작전명 빛글!",
      "(AI특화/중등) AI 로보택시를 연구하는 오픈랩"
    ]
  },
  "가천대학교": {
    short: "가천대",
    tplBase: "templates/gachon/",
    programs: [
      "(초저) AI 휴로와 떠나는 마음건강 탐험대",
      "(초저) 코드블루! 도시의 골든타임을 지켜라",
      "(초고) 데이터로 레벨업! 건강을 지키는 간식 생활",
      "(초고) 주니어 CEO들의 AI 메디 로봇 출시기",
      "(중등) AI와 로보틱스로 여는 메디컬DX",
      "(고등) 디자인씽킹 기반 AI 메디컬 해커톤",
      "(다문화) 다(多)가치 튼튼, 국경 없는 의료대!"
    ]
  }
};
let ORG = "대림대학교";   // 현재 선택된 기관 (진입 게이트에서 설정)
const profile = () => ORG_PROFILES[ORG] || ORG_PROFILES["대림대학교"];
const PROGRAMS_FOR = () => profile().programs;
const ORGS = Object.keys(ORG_PROFILES);

let xlsxTemplateBuf = null;    // 등록양식 xlsx 템플릿
let hwpxTemplateBuf = null;    // 수령대장 hwpx 템플릿
let equipTemplateBuf = null;   // 교구관리대장 hwpx 템플릿
let reportTemplateBuf = null;  // 결과보고서 hwpx 템플릿
let safetyTemplateBuf = null;  // 안전업무일지 hwpx 템플릿
let checklistTemplateBuf = null; // 안전체크리스트 hwpx 템플릿
let payTemplateBuf = null;     // (보조) 강사료 지급신청서 hwpx 템플릿
let juPayTemplateBuf = null;   // (주) 외부전문가 기술활용비 지급신청서 hwpx 템플릿
let safetyPayTemplateBuf = null;      // (안전) 단기근로자 지급신청서 hwpx 템플릿
let safetyContractTemplateBuf = null; // (안전) 단기 근로계약서 hwpx 템플릿
let multiTemplateBuf = null;   // 다문화학생 학교장 확인서 hwpx 템플릿
let caseTemplateBuf = null;    // 프로그램 운영 사례집 hwpx 템플릿
let pledgeTemplateBuf = null;  // 안전관리 서약서 hwpx 템플릿
// 가천대 전용 템플릿 버퍼
let gEquipTemplateBuf = null;     // 교구지급보고서(주)
let gLectureTemplateBuf = null;   // 강의보고서(주/보조)
let gWorkTemplateBuf = null;      // 업무보고서(안전)
let gReportTemplateBuf = null;    // 결과보고서(보조, AI 추진의견)
let gMealTemplateBuf = null;      // 식다과 수령대장(보조)
let gMaterialTemplateBuf = null;  // 교재교구 수령대장(보조)
let gBannerTemplateBuf = null;    // 배너 pptx
let parsedBlocks = null;       // parseRoster 결과 (실명 포함)
let lastOpinions = null;       // AI 추진의견 캐시 {주강사,보조강사,안전관리자}
let lastReviews = null;        // AI 후기 캐시 {학생,학부모,강사}
let lastClasses = null;        // 변환된 등록양식 결과
let rosterBuf = null;
let rosterName = "명단";

// 진입: 기관 선택 게이트만 띄우고, 선택되면 startApp() 실행
window.addEventListener("DOMContentLoaded", () => {
  const gate = $("orgGate");
  gate.querySelectorAll(".org-pick").forEach(btn => {
    btn.addEventListener("click", () => {
      ORG = btn.dataset.org;
      gate.classList.add("hidden");
      startApp();
    }, { once: true });
  });
});

// 헤더에 현재 기관 배지 표시 + body[data-org] 설정(워터마크 등 분기용)
function applyOrgChrome() {
  document.body.dataset.org = ORG;
  const h = document.querySelector(".header-inner h1");
  if (h && !document.getElementById("orgBadge")) {
    const b = document.createElement("span");
    b.id = "orgBadge"; b.className = "org-badge";
    b.title = "다른 기관으로 바꾸려면 새로고침하세요";
    b.textContent = profile().short;
    b.onclick = () => location.reload();
    h.appendChild(b);
  }
  // 기관별로 '표준 양식'·'작성 예시' 다운로드 링크를 교체 (대림대/가천대 양식·프로그램 목록이 다름)
  const exBase = (ORG === "가천대학교") ? "examples/gachon/" : "examples/";
  const tl = $("rosterTemplateLink");
  if (tl) tl.href = profile().tplBase + "캠프명단양식.xlsx";
  const sl = $("rosterSampleLink");
  if (sl) sl.href = exBase + "예시_백암초_캠프명단.xlsx";
}

// 기관별 템플릿 백그라운드 로드
function loadTemplates() {
  const base = profile().tplBase;
  const get = (file, set) => fetch(base + file).then(r => r.ok ? r.arrayBuffer() : Promise.reject())
    .then(b => set(b)).catch(() => {});
  // 공통(등록양식 xlsx·수령대장)은 대림대 templates/에서 로드
  fetch("templates/수업신청학생등록양식.xlsx").then(r => r.arrayBuffer())
    .then(b => { xlsxTemplateBuf = b; }).catch(() => {});
  fetch("templates/수령대장양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { hwpxTemplateBuf = b; }).catch(() => {});

  if (ORG === "가천대학교") { loadGachonTemplates(get); return; }

  // ── 대림대학교 양식 세트 ──
  get("교구관리대장양식.hwpx", b => equipTemplateBuf = b);
  get("결과보고서양식.hwpx", b => reportTemplateBuf = b);
  get("안전업무일지양식.hwpx", b => safetyTemplateBuf = b);
  get("안전체크리스트양식.hwpx", b => checklistTemplateBuf = b);
  get("강사료지급신청서양식.hwpx", b => payTemplateBuf = b);
  get("주강사료지급신청서양식.hwpx", b => juPayTemplateBuf = b);
  get("안전단기근로자지급신청서양식.hwpx", b => safetyPayTemplateBuf = b);
  get("안전단기근로계약서양식.hwpx", b => safetyContractTemplateBuf = b);
  get("다문화학교장확인서양식.hwpx", b => multiTemplateBuf = b);
  get("프로그램운영사례집양식.hwpx", b => caseTemplateBuf = b);
  get("안전관리서약서양식.hwpx", b => pledgeTemplateBuf = b);
}

// ── 가천대학교 양식 세트 ── (HWP 바이너리 안전양식은 자동화 제외 — 빈 양식 링크만 제공)
function loadGachonTemplates(get) {
  get("교구지급보고서양식.hwpx", b => gEquipTemplateBuf = b);
  get("강의보고서양식.hwpx", b => gLectureTemplateBuf = b);
  get("업무보고서양식.hwpx", b => gWorkTemplateBuf = b);
  get("결과보고서양식.hwpx", b => gReportTemplateBuf = b);
  get("식다과수령대장양식.hwpx", b => gMealTemplateBuf = b);
  get("교재교구수령대장양식.hwpx", b => gMaterialTemplateBuf = b);
  get("배너양식.pptx", b => gBannerTemplateBuf = b);
}

async function startApp() {
  applyOrgChrome();
  await resolver.loadBundle();
  resolver.loadProgramDb().then(info => {
    setStatus("dbStatus",
      `원DB 내장됨 — 참고 학교 ${info.schools}개 / 학급 ${info.classes}건`,
      info.schools ? "ok" : "warn");
  });

  loadTemplates();

  // 시·도 드롭다운 채우기
  const sidoSel = $("schoolSido");
  for (const s of SIDO_LIST) {
    const o = document.createElement("option");
    o.value = o.textContent = s;
    sidoSel.appendChild(o);
  }
  sidoSel.addEventListener("change", () => {
    const name = $("schoolSearch").value.trim();
    if (name && sidoSel.value) {
      resolver.learn(name, sidoSel.value);
      setStatus("schoolStatus", `${name} → ${sidoSel.value} (수동 선택)`, "ok");
    }
  });

  setStatus("neisStatus",
    "NEIS 자동조회 사용 중 — 학교명으로 전국 학교의 지역이 자동 입력됩니다." +
    (resolver.neisKey ? " (API 키 적용)" : ""), "ok");

  // null-안전 바인딩 (기관별로 일부 버튼이 없을 수 있음)
  const bind = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  bind("rosterFile", "change", onRoster);
  bind("schoolSearchBtn", "click", onSchoolSearch);
  bind("schoolSearch", "keydown", e => { if (e.key === "Enter") onSchoolSearch(); });
  bind("convertBtn", "click", onConvert);
  bind("downloadBtn", "click", onDownloadXlsx);
  bind("shareBtn", "click", onShareSave);
  bind("aiBtn", "click", onGenOpinions);

  if (ORG === "가천대학교") {
    setupGachonUI(bind);
  } else {
    bind("downloadHwpxBtn", "click", onDownloadHwpx);
    bind("downloadHwpx2Btn", "click", onDownloadHwpx);
    bind("downloadEquipBtn", "click", onDownloadEquip);
    bind("downloadReportBtn", "click", onDownloadReport);
    bind("downloadSafetyBtn", "click", onDownloadSafety);
    bind("downloadChecklistBtn", "click", onDownloadChecklist);
    bind("downloadPayBtn", "click", onDownloadPay);
    bind("downloadJuPayBtn", "click", onDownloadJuPay);
    bind("downloadSafetyPayBtn", "click", onDownloadSafetyPay);
    bind("downloadSafetyContractBtn", "click", onDownloadSafetyContract);
    bind("downloadMultiBtn", "click", onDownloadMulti);
    bind("downloadCaseBtn", "click", onDownloadCase);
    bind("downloadPledgeBtn", "click", onDownloadPledge);
  }

  // 공유 코드 링크로 열렸으면 저장된 세팅 자동 불러오기
  tryLoadFromPath();
}

// 공용: /api/opinion 1건 호출 (실패 시 throw)
async function aiOpinion({ program, kind, who }) {
  const r = await fetch("/api/opinion", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ program, kind, who })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.text || "";
}

// 여러 역할 동시 생성 (부분 실패 허용) → { [who]: text }
async function aiOpinionSet(program, kind, whos) {
  const settled = await Promise.allSettled(
    whos.map(who => aiOpinion({ program, kind, who })));
  const out = {}; const errs = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") out[whos[i]] = s.value;
    else errs.push(`${whos[i]}: ${String(s.reason && s.reason.message || s.reason)}`);
  });
  return { out, errs };
}

// "AI 추진의견" 박스: 결과보고서(추진의견)·운영사례집(후기) 동시 생성 + 복사 버튼
async function onGenOpinions() {
  if (!lastClasses || !lastClasses.length) { alert("먼저 변환하세요."); return; }
  const program = (lastClasses[0].settings && lastClasses[0].settings.program) || lastClasses[0].program || "";
  setStatus("aiResult", "생성 중… (10초 내외)", "");
  const [op, rv] = await Promise.all([
    aiOpinionSet(program, "추진의견", ["주강사", "보조강사", "안전관리자"]),
    aiOpinionSet(program, "후기", ["학생", "학부모", "강사"])
  ]);
  lastOpinions = op.out;    // 다운로드 시 재사용 (중복 호출 절약)
  lastReviews = rv.out;
  const blocks = [];
  const sect = (title, map, whos) => {
    blocks.push(`<div style="margin-top:8px"><b>${title}</b></div>`);
    whos.forEach(w => {
      const t = map[w] || "";
      blocks.push(
        `<div style="margin-top:4px"><span class="muted">${w}</span>
         <div style="display:flex;gap:6px;align-items:flex-start">
           <textarea rows="3" style="flex:1">${t.replace(/</g, "&lt;")}</textarea>
           <button type="button" class="ghost copyBtn" data-t="${escAttr(t)}">복사</button>
         </div></div>`);
    });
  };
  sect("결과보고서 · 추진의견", op.out, ["주강사", "보조강사", "안전관리자"]);
  sect("운영 사례집 · 후기", rv.out, ["학생", "학부모", "강사"]);
  const errs = [...op.errs, ...rv.errs];
  $("aiResult").className = "status " + (errs.length === 6 ? "warn" : "ok");
  $("aiResult").innerHTML = blocks.join("") +
    (errs.length ? `<div class="muted" style="margin-top:6px">일부 실패: ${errs.join(" / ")}</div>` : "");
  // 복사 버튼 바인딩
  $("aiResult").querySelectorAll(".copyBtn").forEach(b => {
    b.onclick = () => { navigator.clipboard.writeText(b.dataset.t || ""); b.textContent = "복사됨"; setTimeout(() => b.textContent = "복사", 1200); };
  });
}

// 현재 세팅을 Firebase(서버 함수 경유)에 저장하고 공유 링크 생성
async function onShareSave() {
  if (!lastClasses || !lastClasses.length) { alert("먼저 변환하세요."); return; }
  const code = $("shareCode").value.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]/g, "");
  if (!code) { alert("공유 코드를 입력하세요 (영문/숫자/한글/-/_)"); return; }
  setStatus("shareResult", "저장 중…", "");
  const payload = {
    rosterName,
    parsedBlocks,
    classes: lastClasses.map(c => ({
      className: c.className, settings: c.settings, school: c.school,
      program: c.program, rows: c.rows, realNames: c.realNames, regionLog: c.regionLog || []
    }))
  };
  try {
    const r = await fetch("/api/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, data: payload })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const url = `${location.origin}/${j.code || code}`;
    $("shareResult").className = "status ok";
    $("shareResult").innerHTML = `✅ 링크 생성됨: <a href="${url}" target="_blank">${url}</a> &nbsp;<button id="copyLink" class="ghost" type="button">복사</button>`;
    const cp = document.getElementById("copyLink");
    if (cp) cp.onclick = () => { navigator.clipboard.writeText(url); cp.textContent = "복사됨"; };
  } catch (e) {
    setStatus("shareResult", `저장 실패: ${e.message} — Vercel 배포 + 환경변수(FIREBASE_*) 설정 후 동작합니다.`, "warn");
  }
}

// 경로의 코드(/코드)로 저장된 세팅 불러와 문서 자동 세팅
async function tryLoadFromPath() {
  const code = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, "")).toLowerCase();
  if (!code || code === "index.html") return;
  setStatus("convertStatus", `코드 '${code}' 불러오는 중…`, "");
  try {
    const r = await fetch(`/api/load?code=${encodeURIComponent(code)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 404 ? "해당 코드를 찾을 수 없습니다" : (j.error || `HTTP ${r.status}`));
    const data = j.data || j;
    rosterName = data.rosterName || "명단";
    parsedBlocks = data.parsedBlocks || [];
    lastClasses = (data.classes || []).map(c => ({ ...c }));
    // 캠프명단·지역·시간·차시·담당자까지 설정 패널 그대로 복원
    if (parsedBlocks.length) { renderSettings(parsedBlocks); applySettingsToPanel(lastClasses); }
    setStatus("rosterStatus", `코드 '${code}'에서 캠프 세팅 불러옴 — 클래스 ${parsedBlocks.length}개 (수정 후 재변환 가능)`, "ok");
    renderPreview(lastClasses);
    refreshDownloadButtons();
    if ($("shareCode")) $("shareCode").value = code;
    setStatus("convertStatus", `코드 '${code}' 불러옴 — 설정이 그대로 복원되었습니다. 아래에서 서류를 바로 다운로드하세요.`, "ok");
    // 템플릿이 늦게 로드돼도 버튼이 켜지도록 잠시 재시도
    let n = 0;
    const iv = setInterval(() => { refreshDownloadButtons(); if (++n > 16) clearInterval(iv); }, 300);
  } catch (e) {
    setStatus("convertStatus", `불러오기 실패: ${e.message}`, "warn");
  }
}

async function onSchoolSearch() {
  const name = $("schoolSearch").value.trim();
  if (!name) return;
  setStatus("schoolStatus", "조회 중…", "");
  const reg = await resolver.resolve(name);
  if (reg.sido) {
    $("schoolSido").value = reg.sido;
    resolver.learn(name, reg.sido);
    setStatus("schoolStatus", `${name} → ${reg.sido} (출처: ${reg.source})`, "ok");
  } else {
    setStatus("schoolStatus", `${name}: 자동조회 실패 — 드롭다운에서 직접 선택하세요.`, "warn");
  }
}

function setStatus(id, msg, cls = "") {
  const el = $(id); if (!el) return;
  el.textContent = msg; el.className = "status " + cls;
}

// 한컴오피스 한셀(HCell)은 sharedStrings에 전용 서식 태그(<hs:size> 등, schemas.haansoft.com)를
// 넣는데, SheetJS가 이를 "Unrecognized rich format"으로 보고 파싱을 중단해 시트가 비어버린다.
// 업로드 직후 그 태그만 제거해 표준 .xlsx로 정규화한다. (한셀 흔적 없으면 원본 그대로 반환)
async function normalizeHcellXlsx(buf) {
  try {
    const zip = await JSZip.loadAsync(buf);
    const ss = zip.file("xl/sharedStrings.xml");
    if (!ss) return buf;
    const xml = await ss.async("string");
    if (xml.indexOf("<hs:") < 0) return buf;        // 한셀 전용 태그 없음 → 손대지 않음
    const cleaned = xml.replace(/<hs:[^>]*\/>/g, "")
                       .replace(/<hs:[^>]*>/g, "")
                       .replace(/<\/hs:[^>]*>/g, "");
    zip.file("xl/sharedStrings.xml", cleaned);
    return await zip.generateAsync({ type: "arraybuffer" });
  } catch (_) {
    return buf;   // 정규화 실패 시 원본으로 시도(원래 동작 보존)
  }
}

// 명단 업로드 → 즉시 파싱 → 편집 가능한 설정 패널 표시
async function onRoster(e) {
  const f = e.target.files[0]; if (!f) return;
  setStatus("rosterStatus", "명단 읽는 중…", "");
  rosterBuf = await normalizeHcellXlsx(await f.arrayBuffer());   // 한셀(HCell) 호환 정규화
  rosterName = f.name.replace(/\.xlsx$/i, "");
  let wb;
  try {
    wb = XLSX.read(rosterBuf, { type: "array" });
  } catch (err) {
    setStatus("rosterStatus",
      `명단을 읽지 못했습니다(${err.message}). 한셀로 저장된 파일이면 Excel/구글시트에서 .xlsx로 다시 저장해 올려주세요.`, "warn");
    return;
  }
  parsedBlocks = parseRoster(wb).filter(b => b.students.length);
  if (!parsedBlocks.length) {
    setStatus("rosterStatus",
      "학생을 찾지 못했습니다. 시트(오전반/오후반)와 '이름·전화' 헤더가 있는 표준 양식인지 확인하세요.", "warn");
    return;
  }
  setStatus("rosterStatus",
    `명단 로드됨: ${f.name} — 클래스 ${parsedBlocks.length}개`, "ok");
  renderSettings(parsedBlocks);
}

// 프로그램명 매칭(부분일치)으로 드롭다운 기본값 찾기
function matchProgram(prog) {
  const p = (prog || "").replace(/\s/g, "");
  return PROGRAMS_FOR().find(opt => {
    const core = opt.replace(/^\([^)]*\)\s*/, "").replace(/\s/g, "");
    return p.includes(core) || core.includes(p.replace(/^\([^)]*\)/, ""));
  }) || "";
}

// 일차 행(날짜+시작/종료 시간) HTML
function dayRowHtml(id, i, date, start, end) {
  return `<div class="dayrow" data-cls="${id}">
    <span class="muted">${i + 1}일차</span>
    <input type="text" class="dDate" value="${date}" placeholder="6월 20일" style="width:84px">
    <input type="time" class="dStart" value="${start}">~
    <input type="time" class="dEnd" value="${end}">
    <button type="button" class="delDay" title="삭제">✕</button>
  </div>`;
}

// 클래스(오전/오후)별 편집 패널
function renderSettings(blocks) {
  const host = $("settings");
  host.innerHTML = "<h2>2.5 캠프 정보 확인·수정 <span class=\"opt\">변환 전</span></h2>";
  let prevId = null;
  for (const blk of blocks) {
    const id = cssId(blk.sheet);
    const selProg = matchProgram(blk.program);
    // 총차시 기본값: 선택된 프로그램이 있으면 그 프로그램 기준(특화류 12), 없으면 명단 과정 기준
    const chasi = defaultChasiForProgram(selProg || blk.program, blk.courseType);
    const isAfternoon = /오후/.test(blk.sheet);
    const defStart = isAfternoon ? "13:00" : "09:00";
    const defEnd = isAfternoon ? "16:10" : "12:10";
    // ① 원DB에 학교+프로그램 일정이 있으면 날짜·시간 자동 채움 ② 없으면 명단 날짜+기본시간
    const sched = parseSchedule(
      resolver.findScheduleRaw(blk.school, programCore(blk.program)),
      isAfternoon ? "pm" : "am");
    let dayRows, dbNote = "";
    if (sched.length) {
      dayRows = sched.map((s, i) =>
        dayRowHtml(id, i, fmtDate(s.date), s.start || defStart, s.end || defEnd)).join("");
      dbNote = '<span class="muted">※ 원DB 일정 자동적용됨(수정 가능)</span>';
    } else {
      const dates = blk.dates.length ? blk.dates : [{ m: 0, d: 0 }];
      dayRows = dates.map((d, i) =>
        dayRowHtml(id, i, d.m ? fmtDate(d) : "", defStart, defEnd)).join("");
    }
    const progOpts = PROGRAMS_FOR().map(p =>
      `<option${p === selProg ? " selected" : ""}>${escHtml(p)}</option>`).join("");
    const orgOpts = ORGS.map(o => `<option${o === ORG ? " selected" : ""}>${o}</option>`).join("");

    host.insertAdjacentHTML("beforeend", `
      <div class="clsbox" data-cls="${id}" data-sheet="${escAttr(blk.sheet)}">
        <div class="clshead"><b>${escHtml(blk.sheet)}</b>
          <span class="muted">${escHtml(blk.school)} · ${blk.students.length}명</span></div>
        <div class="row">
          <label>프로그램명
            <select class="progSel" id="prog_${id}" style="max-width:380px">
              <option value="">— 선택 —</option>${progOpts}
            </select></label>
        </div>
        <div class="row">
          <label><input type="checkbox" class="socialChk" id="social_${id}"> 다문화 / 사회적배려 학급</label>
          <label>총 차시 <input type="number" id="tot_${id}" value="${chasi}" min="1" max="24" style="width:56px"></label>
          <label>기관 <select id="org_${id}">${orgOpts}</select></label>
        </div>
        <div class="row">
          <label>주강사 <input type="text" id="teacher_${id}" value="${escAttr(blk.mainTeacher || "")}" placeholder="주강사" style="width:90px"></label>
          <label>보조강사 <input type="text" id="assist_${id}" value="${escAttr(blk.assistantTeacher || "")}" placeholder="보조강사" style="width:90px"></label>
          <label>안전관리자 <input type="text" id="safety_${id}" value="${escAttr(blk.safetyManager || "")}" placeholder="안전관리자" style="width:90px"></label>
          <label>교구 수량 <input type="number" id="qty_${id}" placeholder="개수" style="width:64px"></label>
          ${prevId ? `<button type="button" class="ghost copyPrev" data-cls="${id}" data-prev="${prevId}" title="위 반의 프로그램·차시·기관·주/보조/안전강사·교구를 그대로 복사">⬆ 위와 동일</button>` : ""}
        </div>
        <div class="row"><span class="muted">※ 강사별 서류(교구관리대장·주강사료·안전 지급/계약서)는 해당 담당자 이름을 입력해야 다운로드할 수 있습니다.</span></div>
        <div class="row">${dbNote}</div>
        <div class="days" id="days_${id}">${dayRows}</div>
        <button type="button" class="addDay" data-cls="${id}">+ 일차 추가</button>
      </div>`);

    // 다문화 체크 시 확인 질문
    $(`social_${id}`).addEventListener("change", (ev) => {
      if (ev.target.checked) {
        const ok = confirm(`[${blk.sheet}] 다문화/사회적배려 학급으로 설정합니다.\n\n캠프 명단의 '메모(특이사항)' 칸에 다문화 학생을 '다문화'라고 표시하셨나요?\n\n표시된 학생만 공란 처리되고, 나머지 일반학생에게 '일반학생 여부 = Y'가 들어갑니다.`);
        if (!ok) ev.target.checked = false;
      }
    });
    // 일차 추가
    host.querySelector(`.addDay[data-cls="${id}"]`).addEventListener("click", () => {
      const cont = $(`days_${id}`);
      const i = cont.querySelectorAll(".dayrow").length;
      cont.insertAdjacentHTML("beforeend", dayRowHtml(id, i, "", defStart, defEnd));
      bindDelDay(cont);
    });
    bindDelDay($(`days_${id}`));
    // 프로그램 변경 → 해당 프로그램 기준 총차시 자동 갱신(특화류 12 / 그 외 8)
    $(`prog_${id}`).addEventListener("change", (ev) => {
      const totEl = $(`tot_${id}`);
      if (totEl) totEl.value = defaultChasiForProgram(ev.target.value, "");
    });
    // 담당자 입력 변화 → 담당자 필요 버튼 게이팅 갱신
    $(`teacher_${id}`).addEventListener("input", updateGatedBtns);
    $(`safety_${id}`).addEventListener("input", updateGatedBtns);
    // "위와 동일": 이전 반의 프로그램·차시·기관·담당자·교구 복사 (날짜·시간은 이 반 유지)
    const cp = host.querySelector(`.copyPrev[data-cls="${id}"]`);
    if (cp) cp.addEventListener("click", () => {
      const p = cp.dataset.prev, c = cp.dataset.cls;
      const copy = (pre) => { const a = $(`${pre}_${p}`), b = $(`${pre}_${c}`); if (a && b) b.value = a.value; };
      ["prog", "tot", "org", "teacher", "assist", "safety", "qty"].forEach(copy);
      const sa = $(`social_${p}`), sb = $(`social_${c}`); if (sa && sb) sb.checked = sa.checked;
      updateGatedBtns();
    });
    prevId = id;
  }
  host.style.display = blocks.length ? "block" : "none";
}

// 링크 로드 시: 저장된 settings 값을 설정 패널 입력칸에 그대로 복원
function applySettingsToPanel(classes) {
  for (const c of classes) {
    const id = cssId(c.className);
    const st = c.settings || {};
    const set = (pre, val) => { const el = $(`${pre}_${id}`); if (el && val != null && val !== "") el.value = val; };
    if ($(`prog_${id}`) && st.program) $(`prog_${id}`).value = st.program;
    const sc = $(`social_${id}`); if (sc) sc.checked = !!st.social;
    set("tot", st.chasi);
    if ($(`org_${id}`) && st.org) $(`org_${id}`).value = st.org;
    set("teacher", st.mainTeacher);
    set("assist", st.assistantTeacher);
    set("safety", st.safetyManager);
    set("qty", st.equipQty);
    const cont = $(`days_${id}`);
    if (cont && Array.isArray(st.days) && st.days.length) {
      cont.innerHTML = st.days.map((d, i) =>
        dayRowHtml(id, i, d.date ? fmtDate(d.date) : "", d.start || "", d.end || "")).join("");
      bindDelDay(cont);
    }
  }
}

// 담당자 입력 여부 — 설정 패널(라이브 입력) 우선, 패널이 없으면(링크 로드) 저장된 settings 사용
function anyMainTeacher() {
  const dom = [...document.querySelectorAll('[id^="teacher_"]')];
  if (dom.length) return dom.some(i => i.value.trim());
  return !!(lastClasses && lastClasses.some(c => (c.settings || {}).mainTeacher));
}
function anySafetyManager() {
  const dom = [...document.querySelectorAll('[id^="safety_"]')];
  if (dom.length) return dom.some(i => i.value.trim());
  return !!(lastClasses && lastClasses.some(c => (c.settings || {}).safetyManager));
}
// 담당자가 입력된 서류만 버튼 활성화 (주강사: 교구·주강사료 / 안전관리자: 안전 지급·계약서)
function updateGatedBtns() {
  if (ORG === "가천대학교") { refreshGachonButtons(); return; }
  const ready = !!(lastClasses && lastClasses.length);
  const hasMain = anyMainTeacher();
  const hasSafety = anySafetyManager();
  const set = (id, v) => { const el = $(id); if (el) el.disabled = v; };
  set("downloadEquipBtn", !(ready && equipTemplateBuf && hasMain));
  set("downloadJuPayBtn", !(ready && juPayTemplateBuf && hasMain));
  set("downloadSafetyPayBtn", !(ready && safetyPayTemplateBuf && hasSafety));
  set("downloadSafetyContractBtn", !(ready && safetyContractTemplateBuf && hasSafety));
  set("downloadPledgeBtn", !(ready && pledgeTemplateBuf && hasSafety));
}

function bindDelDay(cont) {
  cont.querySelectorAll(".delDay").forEach(btn => {
    btn.onclick = () => { btn.closest(".dayrow").remove(); renumberDays(cont); };
  });
}
function renumberDays(cont) {
  cont.querySelectorAll(".dayrow .muted").forEach((el, i) => el.textContent = `${i + 1}일차`);
}

// 설정 패널에서 클래스별 설정 읽기
function readSettings() {
  const map = {};
  document.querySelectorAll(".clsbox").forEach(box => {
    const id = box.dataset.cls;
    const sheet = box.dataset.sheet;
    const days = [...box.querySelectorAll(".dayrow")].map(row => ({
      date: parseDateInput(row.querySelector(".dDate").value),
      start: row.querySelector(".dStart").value,
      end: row.querySelector(".dEnd").value
    })).filter(d => d.date);
    map[sheet] = {
      social: $(`social_${id}`).checked,
      chasi: parseInt($(`tot_${id}`).value, 10) || 8,
      program: $(`prog_${id}`).value,
      org: $(`org_${id}`).value,
      mainTeacher: $(`teacher_${id}`).value.trim(),
      assistantTeacher: $(`assist_${id}`).value.trim(),
      safetyManager: $(`safety_${id}`).value.trim(),
      equipQty: $(`qty_${id}`).value.trim(),
      days,
      dates: days.map(d => d.date)
    };
  });
  return map;
}

// "6월 20일" → {m,d}
function parseDateInput(s) {
  const m = (s || "").match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? { m: +m[1], d: +m[2] } : null;
}

async function onConvert() {
  if (!rosterBuf) { alert("캠프명단을 먼저 업로드하세요"); return; }
  if (!xlsxTemplateBuf) { alert("등록양식 템플릿 로딩 중입니다. 잠시 후 다시 시도하세요."); return; }
  setStatus("convertStatus", "변환 중…", "");

  const settings = readSettings();
  const socialByClass = {};
  for (const k in settings) socialByClass[k] = settings[k].social;

  // 사용자가 '2. 학교 검색'에 직접 입력한 학교명은 명단 시트보다 우선한다.
  const userSchool = (($("schoolSearch") && $("schoolSearch").value) || "").trim();

  lastClasses = await toRegistrationRows(parsedBlocks, resolver, { socialByClass });
  // 설정(차시/날짜/시간/기관/주강사/교구수량)·학교·실명을 클래스 결과에 부착
  for (const c of lastClasses) {
    const blk = parsedBlocks.find(b => b.sheet === c.className);
    c.settings = settings[c.className] || {};
    // 학교명 우선순위: 사용자 입력(2번 학교 검색) → 명단 메타(교육 장소) → 학생 학교 폴백 → 기존값.
    // (비어 있으면 서류의 마스터 기본값 '증안초등학교'가 그대로 남으므로 반드시 채운다)
    c.school = (userSchool || (blk ? blk.school : "") || c.school || "").trim();
    c.realNames = blk ? blk.students.map(s => s.name) : [];
  }

  renderPreview(lastClasses);
  const total = refreshDownloadButtons();
  setStatus("convertStatus",
    `변환 완료: ${lastClasses.length}개 클래스 / 학생 ${total}명`, "ok");
}

// 다운로드 버튼 활성화 일괄 갱신 (변환 완료 / 링크 로드 / 템플릿 로드 후 공용)
function refreshDownloadButtons() {
  if (!lastClasses || !lastClasses.length) return 0;
  $("shareBox").style.display = "flex";   // 데이터 준비되면 공유 박스 노출
  $("aiBox").style.display = "flex";      // AI 추진의견 박스 노출
  const total = lastClasses.reduce((n, c) => n + (c.rows ? c.rows.length : 0), 0);
  // 가천대 모드는 대림대 버튼이 없으므로(가천대 그리드로 교체됨) 먼저 분기
  if (ORG === "가천대학교") { refreshGachonButtons(total); return total; }
  $("downloadBtn").disabled = total === 0;
  $("downloadHwpxBtn").disabled = total === 0 || !hwpxTemplateBuf;
  $("downloadHwpx2Btn").disabled = total === 0 || !hwpxTemplateBuf;
  $("downloadReportBtn").disabled = total === 0 || !reportTemplateBuf;
  $("downloadSafetyBtn").disabled = total === 0 || !safetyTemplateBuf;
  $("downloadChecklistBtn").disabled = total === 0 || !checklistTemplateBuf;
  $("downloadPayBtn").disabled = total === 0 || !payTemplateBuf;
  const anySocial = lastClasses.some(c => (c.settings || {}).social);
  $("downloadMultiBtn").disabled = total === 0 || !multiTemplateBuf || !anySocial;
  $("downloadCaseBtn").disabled = total === 0 || !caseTemplateBuf;
  updateGatedBtns();   // 교구·주강사료(주강사) / 안전 지급·계약서(안전관리자) 게이팅
  return total;
}

function renderPreview(classes) {
  const card = $("resultCard");
  if (!card) return;   // 캐시 불일치 등으로 미리보기 영역이 없으면 안전하게 종료
  card.style.display = classes.length ? "block" : "none";
  $("meta").innerHTML = classes
    .map(c => `<b>${escHtml(c.className)}</b>: ${escHtml(c.school)} / ${escHtml(c.program)} (${c.rows.length}명)`)
    .join("<br>");

  // 지역(시·도) 확인·수정 — 미확인 학교뿐 아니라 자동 인식된 학교도 모두 노출해
  // NEIS가 틀리게 잡은 지역(예: 오현초→서울)을 사용자가 직접 바로잡을 수 있게 한다.
  const bySchool = {};
  for (const r of allLog) { if (!(r.school in bySchool)) bySchool[r.school] = r.sido || ""; }
  const schools = Object.keys(bySchool).filter(Boolean);
  if (schools.length) {
    const anyUnresolved = schools.some(sc => !bySchool[sc]);
    let h = anyUnresolved
      ? `⚠ 지역(시·도) 확인 — 미확인 학교는 반드시 선택하고, 자동 인식이 틀렸으면 바꾼 뒤 [적용]을 누르세요:`
      : `지역(시·도) 확인 — 자동 인식이 틀렸으면 바꾼 뒤 [적용]을 누르세요:`;
    schools.forEach((sc) => {
      const cur = bySchool[sc];
      const opts = `<option value="">— 선택 —</option>` +
        SIDO_LIST.map(s => `<option${s === cur ? " selected" : ""}>${s}</option>`).join("");
      h += `<div class="row" style="margin-top:4px">
        <b${cur ? "" : ' style="color:#c00"'}>${escHtml(sc)}</b>
        <select class="fixSido" data-school="${escAttr(sc)}" data-cur="${escAttr(cur)}">${opts}</select>
        <span class="muted">${cur ? `현재: ${escHtml(cur)}` : "미인식 — 선택 필요"}</span></div>`;
    });
    h += `<button id="applyFix" style="margin-top:6px">선택한 지역 적용</button>`;
    $("warn").innerHTML = h;
    $("applyFix").onclick = () => {
      document.querySelectorAll(".fixSido").forEach(sel => {
        const v = sel.value, cur = sel.dataset.cur || "";
        if (v && v !== cur) {
          resolver.learn(sel.dataset.school, v);              // map 최우선 → 재변환 시 반영
          if (resolver.cache) delete resolver.cache[sel.dataset.school];  // NEIS 캐시 무효화
        }
      });
      onConvert();   // 재변환 → 적용
    };
  } else {
    $("warn").innerHTML = "";
  }

  const head = ["학생명","연락처","이메일","지역","학교","학년","반","일반학생 여부"];
  let html = "";
  for (const c of classes) {
    html += `<h3 class="cls">${escHtml(c.className)} (${c.rows.length}명)</h3>`;
    html += "<table><thead><tr>" + head.map(h => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
    for (const r of c.rows) {
      html += "<tr>" + head.map(h => `<td>${escHtml(r[h] || "")}</td>`).join("") + "</tr>";
    }
    html += "</tbody></table>";
  }
  $("preview").innerHTML = html;
}

// 등록양식 xlsx (익명화) — 클래스별 개별 다운로드
async function onDownloadXlsx() {
  if (!lastClasses || !lastClasses.length) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const blob = await buildRegistrationXlsx(xlsxTemplateBuf, c.rows);
    triggerDownload(blob, `수업신청학생등록양식_${safeName(rosterName)}_${safeName(c.className)}.xlsx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 수령대장 hwpx (실명) — 클래스별 개별 다운로드
async function onDownloadHwpx() {
  if (!lastClasses || !lastClasses.length || !hwpxTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const dates = (st.dates || []).filter(Boolean);
    const blob = await buildReceiptHwpx(hwpxTemplateBuf, {
      names: c.realNames || [],
      chasi: st.chasi || 8,
      dates
    });
    triggerDownload(blob, `수령대장_${safeName(rosterName)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 교구 관리대장 hwpx — 클래스별 개별 다운로드
async function onDownloadEquip() {
  if (!lastClasses || !lastClasses.length || !equipTemplateBuf) return;

  // 주강사 성명 사전 확인: 비어 있으면 입력받아 설정 패널에도 반영
  for (const c of lastClasses) {
    const st = c.settings || (c.settings = {});
    if (!st.mainTeacher) {
      const v = prompt(`[${c.className}] 교구관리대장에 들어갈 주강사 성명을 입력하세요.`, "");
      if (v === null) return;                 // 취소 시 전체 중단
      st.mainTeacher = v.trim();
      const inp = document.querySelector(`#teacher_${cssId(c.className)}`);
      if (inp) inp.value = st.mainTeacher;     // 패널 입력칸에도 반영
    }
  }

  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const blob = await buildEquipmentLedgerHwpx(equipTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      org: st.org || "",
      mainTeacher: st.mainTeacher || "",
      equipQty: st.equipQty || "",
      days: st.days || [],
      year: 2026
    });
    triggerDownload(blob, `교구관리대장_${ownerTag(st.mainTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 다운로드 직전 AI 의견/후기 확보 (캐시 있으면 재사용, 없으면 자동 생성, 실패 시 빈 객체)
async function ensureOpinions(program) {
  if (lastOpinions && Object.keys(lastOpinions).length) return lastOpinions;
  try { lastOpinions = (await aiOpinionSet(program, "추진의견", ["주강사", "보조강사", "안전관리자"])).out; }
  catch { lastOpinions = {}; }
  return lastOpinions;
}
async function ensureReviews(program) {
  if (lastReviews && Object.keys(lastReviews).length) return lastReviews;
  try { lastReviews = (await aiOpinionSet(program, "후기", ["학생", "학부모", "강사"])).out; }
  catch { lastReviews = {}; }
  return lastReviews;
}

// 결과보고서 hwpx (보조강사 취합) — AI 추진의견(주/보조/안전) 자동삽입 + 클래스별 다운로드
async function onDownloadReport() {
  if (!lastClasses || !lastClasses.length || !reportTemplateBuf) return;
  const program = (lastClasses[0].settings && lastClasses[0].settings.program) || lastClasses[0].program || "";
  setStatus("convertStatus", "AI 추진의견 생성 중…", "");
  const opinions = await ensureOpinions(program);
  setStatus("convertStatus", "결과보고서 생성 중…", "");
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const blob = await buildReportHwpx(reportTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      org: st.org || "",
      assistantTeacher: st.assistantTeacher || "",
      days: st.days || [],
      year: 2026,
      opinions
    });
    triggerDownload(blob, `결과보고서_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
  setStatus("convertStatus", Object.keys(opinions).length ? "결과보고서 다운로드 완료 (AI 추진의견 포함)" : "결과보고서 다운로드 완료 (AI 의견 생성 실패 — 빈칸)", "ok");
}

// 프로그램 운영 사례집 hwpx — AI 후기(학생/학부모/강사) 자동삽입 + 클래스별 다운로드
async function onDownloadCase() {
  if (!lastClasses || !lastClasses.length || !caseTemplateBuf) return;
  const program = (lastClasses[0].settings && lastClasses[0].settings.program) || lastClasses[0].program || "";
  setStatus("convertStatus", "AI 후기 생성 중…", "");
  const reviews = await ensureReviews(program);
  setStatus("convertStatus", "운영 사례집 생성 중…", "");
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const blob = await buildCaseBookHwpx(caseTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      days: st.days || [],
      year: 2026,
      reviews,
      studentNames: c.realNames || [],          // 학생 랜덤 1명 추출용
      teacher: st.assistantTeacher || ""         // 강사 = 보조강사(익명처리)
    });
    triggerDownload(blob, `프로그램운영사례집_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
  setStatus("convertStatus", Object.keys(reviews).length ? "운영 사례집 다운로드 완료 (AI 후기 포함)" : "운영 사례집 다운로드 완료 (AI 후기 생성 실패 — 예시 유지)", "ok");
}

// 안전관리 서약서 hwpx — 클래스별 (캠프명·일시/장소·현장안전담당·서약일 자동)
async function onDownloadPledge() {
  if (!lastClasses || !lastClasses.length || !pledgeTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const blob = await buildSafetyPledgeHwpx(pledgeTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      safetyManager: st.safetyManager || "",
      days: st.days || [],
      year: 2026
    });
    triggerDownload(blob, `안전관리서약서_${ownerTag(st.safetyManager)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 안전업무일지 hwpx (안전관리자 서류) — 클래스별 개별 다운로드
async function onDownloadSafety() {
  if (!lastClasses || !lastClasses.length || !safetyTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    if (!st.safetyManager) {
      const v = prompt(`[${c.className}] 안전업무일지의 안전관리자 성명을 입력하세요.`, "");
      if (v === null) return;
      st.safetyManager = v.trim();
      const inp = document.querySelector(`#safety_${cssId(c.className)}`);
      if (inp) inp.value = st.safetyManager;
    }
    const blob = await buildSafetyLogHwpx(safetyTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      org: st.org || "",
      safetyManager: st.safetyManager || "",
      days: st.days || [],
      year: 2026
    });
    triggerDownload(blob, `안전업무일지_${ownerTag(st.safetyManager)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 운영 전후 안전관리 체크리스트 hwpx — 점검책임자(안전관리자)·점검일자 채움
async function onDownloadChecklist() {
  if (!lastClasses || !lastClasses.length || !checklistTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    if (!st.safetyManager) {
      const v = prompt(`[${c.className}] 안전체크리스트의 점검책임자(안전관리자) 성명을 입력하세요.`, "");
      if (v === null) return;
      st.safetyManager = v.trim();
      const inp = document.querySelector(`#safety_${cssId(c.className)}`);
      if (inp) inp.value = st.safetyManager;
    }
    const blob = await buildChecklistHwpx(checklistTemplateBuf, {
      safetyManager: st.safetyManager || "",
      days: st.days || [],
      year: 2026
    });
    triggerDownload(blob, `안전체크리스트_${ownerTag(st.safetyManager)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

const EDU_MAP = { "초저": "초등 저학년", "초고": "초등 고학년", "중등": "중등", "고등": "고등", "다문화": "다문화" };

// 강사료 지급신청서 hwpx (보조강사용) — 캠프 1건당 1부, 오전+오후 합산
async function onDownloadPay() {
  if (!lastClasses || !lastClasses.length || !payTemplateBuf) return;
  const c0 = lastClasses[0];
  const blk0 = parsedBlocks.find(b => b.sheet === c0.className) || {};
  const UNIT = 45000;   // 차시당 단가

  // 클래스별 산출내역 줄(완성본 형식 "6/20~21 45,000원 X 4차시 X 2회") + 총차시 + 마지막일
  let totalChasi = 0, last = null;
  const lines = [];
  for (const c of lastClasses) {
    const st = c.settings || {};
    const ch = st.chasi || 0;
    totalChasi += ch;
    const ampm = /오후/.test(c.className) ? "오후" : "오전";
    const dd = (st.days || []).map(d => d.date).filter(Boolean);
    const nd = dd.length;
    const f = dd[0], l = dd[nd - 1];
    const perDay = nd ? ch / nd : ch;
    const perDayTxt = Number.isInteger(perDay) ? perDay : perDay.toFixed(1);
    if (f && l) lines.push(`(${ampm}) ${f.m}/${f.d}~${l.d} ${UNIT.toLocaleString()}원 X ${perDayTxt}차시 X ${nd}회`);
    for (const d of (st.days || [])) {
      if (d.date && (!last || d.date.m * 100 + d.date.d > last.m * 100 + last.d)) last = d.date;
    }
  }
  const amount = (UNIT * totalChasi).toLocaleString();
  const lastDate = last ? `2026년 ${last.m}월 ${last.d}일` : "";
  const eduTarget = EDU_MAP[blk0.courseLevel] || blk0.courseLevel || "";

  const blob = await buildPayApplicationHwpx(payTemplateBuf, {
    program: (c0.settings && c0.settings.program) || c0.program || "",
    school: c0.school || "",
    assistantTeacher: (c0.settings || {}).assistantTeacher || "",
    eduTarget, payoutLines: lines, amount, lastDate, year: 2026
  });
  triggerDownload(blob, `강사료지급신청서_${ownerTag((c0.settings || {}).assistantTeacher)}.hwpx`);
}

// (주) 외부전문가 기술활용비 지급신청서 — 캠프 1건당 1부, 주강사. 단가 75,000원/차시
async function onDownloadJuPay() {
  if (!lastClasses || !lastClasses.length || !juPayTemplateBuf) return;
  const c0 = lastClasses[0];
  const blk0 = parsedBlocks.find(b => b.sheet === c0.className) || {};
  const UNIT = 75000;

  let totalChasi = 0, last = null;
  const lines = [];
  for (const c of lastClasses) {
    const st = c.settings || {};
    const ch = st.chasi || 0;
    totalChasi += ch;
    const ampm = /오후/.test(c.className) ? "오후" : "오전";
    const cdays = (st.days || []).map(d => d.date).filter(Boolean);
    const cl = cdays[cdays.length - 1];
    if (cl) lines.push(`(${ampm}) ${cl.m}/${cl.d} ${UNIT.toLocaleString()}원 X 1학급 X ${ch}차시`);
    for (const d of (st.days || [])) {
      if (d.date && (!last || d.date.m * 100 + d.date.d > last.m * 100 + last.d)) last = d.date;
    }
  }
  const amount = (UNIT * totalChasi).toLocaleString();
  const lastDate = last ? `2026년 ${last.m}월 ${last.d}일` : "";
  const eduTarget = EDU_MAP[blk0.courseLevel] || blk0.courseLevel || "";

  const blob = await buildPayApplicationHwpx(juPayTemplateBuf, {
    program: (c0.settings && c0.settings.program) || c0.program || "",
    school: c0.school || "",
    eduTarget, payoutLines: lines, amount, lastDate, year: 2026,
    slots: [
      " (오전) 6/21 100,000원 X 1학급 X 4차시",
      " (오후) 6/21 100,000원 X 1학급 X 4차시",
      " (오전) 6/28 100,000원 X 1학급 X 4차시"
    ],
    amountSlot: " N,000,000원"
  });
  triggerDownload(blob, `주강사료지급신청서_${ownerTag((c0.settings || {}).mainTeacher)}.hwpx`);
}

const SAFE_UNIT = 20000;        // 안전 단기근로자 차시당 단가
const SAFE_DAY_CAP = 60000;     // 반(班) 단위 1일 한도 (= 3차시분)
const WD = ["일", "월", "화", "수", "목", "금", "토"];

// 안전 정산: 반별 일별차시(=총차시/일수) → 일별 min(차시×20,000, 60,000), 반별·전체 합산
function calcSafetyPay() {
  let total = 0;
  const lines = [];
  let last = null;
  for (const c of lastClasses) {
    const st = c.settings || {};
    const days = (st.days || []).filter(d => d.date);
    const nd = days.length;
    if (!nd) continue;
    const perDay = (st.chasi || 0) / nd;                  // 일별 차시
    const dayAmt = Math.min(perDay * SAFE_UNIT, SAFE_DAY_CAP);
    total += dayAmt * nd;
    const ampm = /오후/.test(c.className) ? "(오후)" : "(오전)";
    const f = days[0].date, l = days[nd - 1].date;
    const perDayTxt = Number.isInteger(perDay) ? perDay : perDay.toFixed(1);
    lines.push(`${ampm} ${f.m}/${f.d}~${l.m}/${l.d} ${SAFE_UNIT.toLocaleString()}원 X 1학급 X ${perDayTxt}차시 (1일 한도 ${SAFE_DAY_CAP.toLocaleString()}원)`);
    for (const d of days) if (!last || d.date.m * 100 + d.date.d > last.m * 100 + last.d) last = d.date;
  }
  return { total, lines, last };
}

// 안전관리자 성명 확보 (비면 입력받아 패널에도 반영). 취소 시 null
function ensureSafetyManager() {
  for (const c of lastClasses) {
    const st = c.settings || (c.settings = {});
    if (!st.safetyManager) {
      const v = prompt(`[${c.className}] 안전 서류의 안전관리자 성명을 입력하세요.`, "");
      if (v === null) return null;
      st.safetyManager = v.trim();
      const inp = document.querySelector(`#safety_${cssId(c.className)}`);
      if (inp) inp.value = st.safetyManager;
    }
  }
  return (lastClasses.find(c => (c.settings || {}).safetyManager) || {}).settings.safetyManager || "";
}

// (안전) 단기근로자 지급신청서 — 캠프 1건당 1부
async function onDownloadSafetyPay() {
  if (!lastClasses || !lastClasses.length || !safetyPayTemplateBuf) return;
  const nm = ensureSafetyManager();
  if (nm === null) return;
  const c0 = lastClasses[0];
  const blk0 = parsedBlocks.find(b => b.sheet === c0.className) || {};
  const { total, lines, last } = calcSafetyPay();
  const lastDate = last ? `2026년 ${last.m}월 ${last.d}일` : "";
  const eduTarget = EDU_MAP[blk0.courseLevel] || blk0.courseLevel || "";

  const blob = await buildSafetyPayHwpx(safetyPayTemplateBuf, {
    program: (c0.settings && c0.settings.program) || c0.program || "",
    school: c0.school || "",
    eduTarget, payoutLines: lines, amount: total.toLocaleString(), lastDate
  });
  triggerDownload(blob, `안전단기근로자지급신청서_${ownerTag(nm)}.hwpx`);
}

// (안전) 단기 근로계약서 — 캠프 1건당 1부
async function onDownloadSafetyContract() {
  if (!lastClasses || !lastClasses.length || !safetyContractTemplateBuf) return;
  const nm = ensureSafetyManager();
  if (nm === null) return;
  const c0 = lastClasses[0];
  const { total } = calcSafetyPay();

  // 날짜별 오전/오후 시간 병합
  const byDate = new Map();
  for (const c of lastClasses) {
    const st = c.settings || {};
    const isPM = /오후/.test(c.className);
    for (const d of (st.days || [])) {
      if (!d.date) continue;
      const k = d.date.m * 100 + d.date.d;
      const e = byDate.get(k) || { m: d.date.m, d: d.date.d };
      if (isPM) { e.pmStart = d.start; e.pmEnd = d.end; }
      else { e.amStart = d.start; e.amEnd = d.end; }
      byDate.set(k, e);
    }
  }
  const dateList = [...byDate.values()].sort((a, b) => a.m - b.m || a.d - b.d)
    .map(e => ({ ...e, wd: WD[new Date(2026, e.m - 1, e.d).getDay()] }));
  const first = dateList[0], lastD = dateList[dateList.length - 1];

  const blob = await buildSafetyContractHwpx(safetyContractTemplateBuf, {
    name: nm,
    school: c0.school || "",
    dateList,
    firstDate: first, lastDate: lastD,
    amount: total.toLocaleString(),
    month: first ? first.m : ""
  });
  triggerDownload(blob, `안전단기근로계약서_${ownerTag(nm)}.hwpx`);
}

// 다문화학생 학교장 확인서 — 다문화 체크된 클래스별, 메모에 '다문화' 표시된 학생 명단
async function onDownloadMulti() {
  if (!lastClasses || !lastClasses.length || !multiTemplateBuf) return;
  const targets = lastClasses.filter(c => (c.settings || {}).social);
  if (!targets.length) { alert("다문화/사회적배려 학급으로 체크된 클래스가 없습니다."); return; }

  let made = 0;
  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    const blk = parsedBlocks.find(b => b.sheet === c.className) || {};
    const names = (blk.students || []).filter(s => /다문화/.test(s.memo || "")).map(s => s.name);
    if (!names.length) {
      alert(`[${c.className}] 메모(특이사항)에 '다문화'로 표시된 학생이 없어 건너뜁니다.`);
      continue;
    }
    const st = c.settings || {};
    const days = (st.days || []).map(d => d.date).filter(Boolean);
    const f = days[0];
    const date = f ? `2026년 ${f.m}월 ${f.d}일` : "";
    const blob = await buildMulticulturalConfirmHwpx(multiTemplateBuf, {
      school: c.school || "", names, count: names.length, date
    });
    triggerDownload(blob, `다문화학교장확인서_${safeName(c.school || rosterName)}_${safeName(c.className)}.hwpx`);
    made++;
    if (i < targets.length - 1) await sleep(350);
  }
  if (!made) alert("생성된 확인서가 없습니다. 명단 메모에 '다문화' 표시를 확인하세요.");
}

// ============================================================
//  가천대학교 모드 — 다운로드 UI·핸들러
//  자동화 대상(hwpx 6종 + 배너): 교구지급보고서·강의보고서·결과보고서·식다과/교재교구 수령대장·업무보고서
//  HWP 바이너리 안전양식(이수증·서약서·안전결과보고서·체크리스트)·출강확인서는 자동화 제외(원본 그대로 제출).
// ============================================================

// 가천대 다운로드 그리드로 교체 + 사전제출 안내 + 핸들러 바인딩
function setupGachonUI(bind) {
  const wrap = document.querySelector(".dl-wrap");
  if (wrap) wrap.innerHTML = `
    <h3 class="dl-title">서류 다운로드 <span class="opt">변환 후 활성화</span></h3>
    <div class="dl-group">
      <h4 class="dl-h dl-h-common">📋 공통 · 학생</h4>
      <div class="dl-grid">
        <button id="gDlXlsx" class="btn-dl dl-common" disabled><b class="idx">학생</b>수업신청학생등록양식<small>xlsx · 익명화 · 클래스별</small></button>
        <button id="gDlBanner" class="btn-dl dl-common" disabled><b class="idx">배너</b>캠프 배너<small>pptx · 학교명·일시 자동</small></button>
      </div>
    </div>
    <div class="dl-group">
      <h4 class="dl-h dl-h-main">🔵 1. 주강사</h4>
      <div class="dl-grid">
        <button id="gDlEquip" class="btn-dl dl-main" disabled><b class="idx">1-1</b>교구 지급 보고서<small>hwpx · 주강사 필요</small></button>
        <button id="gDlLectureMain" class="btn-dl dl-main" disabled><b class="idx">1-2</b>강의 보고서(주강사)<small>hwpx · 75,000원/시간 · 캠프 1부</small></button>
      </div>
    </div>
    <div class="dl-group">
      <h4 class="dl-h dl-h-assist">🟢 2. 보조강사</h4>
      <div class="dl-grid">
        <button id="gDlReport" class="btn-dl dl-assist" disabled><b class="idx">2-1</b>결과 보고서<small>hwpx · AI 추진의견 · 클래스별</small></button>
        <button id="gDlMeal" class="btn-dl dl-assist" disabled><b class="idx">2-2</b>식·다과 수령대장<small>hwpx · 실명 · 클래스별</small></button>
        <button id="gDlMaterial" class="btn-dl dl-assist" disabled><b class="idx">2-3</b>교재·교구 수령대장<small>hwpx · 실명 · 클래스별</small></button>
        <button id="gDlLectureAssist" class="btn-dl dl-assist" disabled><b class="idx">2-4</b>강의 보고서(보조강사)<small>hwpx · 45,000원/시간 · 캠프 1부</small></button>
      </div>
    </div>
    <div class="dl-group">
      <h4 class="dl-h dl-h-safety">🟠 3. 현장안전관리자</h4>
      <div class="dl-grid">
        <a class="btn-dl dl-safety" href="templates/gachon/안전관리이수증양식.hwpx" download="3-1. 안전관리 이수증 양식.hwpx"><b class="idx">3-1</b>안전관리 이수증<small>빈 양식 · 직접 작성</small></a>
        <a class="btn-dl dl-safety" href="templates/gachon/안전관리서약서양식.hwpx" download="3-2. 안전관리 서약서 양식.hwpx"><b class="idx">3-2</b>안전관리 서약서<small>빈 양식 · 직접 작성</small></a>
        <a class="btn-dl dl-safety" href="templates/gachon/안전결과보고서양식.hwpx" download="3-3. 안전결과보고서 양식.hwpx"><b class="idx">3-3</b>안전결과보고서<small>빈 양식 · 직접 작성</small></a>
        <a class="btn-dl dl-safety" href="templates/gachon/안전체크리스트양식.hwpx" download="3-4. 운영 전후 안전 체크리스트 양식.hwpx"><b class="idx">3-4</b>안전 체크리스트<small>빈 양식 · 직접 작성</small></a>
        <button id="gDlWork" class="btn-dl dl-safety" disabled><b class="idx">3-5</b>업무 보고서<small>hwpx · 안전관리자 필요 · 정산 · 캠프 1부</small></button>
      </div>
      <p class="hint" style="margin-top:8px">※ 3-1~3-4는 한글 <b>구버전(.hwp)</b> 양식이라 현재 빈 양식만 제공됩니다(자동 작성 불가). <b>.hwpx로 변환</b>해 주시면 학교·기간·안전관리자 자동 작성을 추가할 수 있습니다.</p>
    </div>`;

  // 사전제출 안내 카드 (강사지원서·출강확인서) — 다운로드 영역 위에 삽입
  if (!$("preSubmitCard")) {
    const card = document.createElement("section");
    card.className = "card";
    card.id = "preSubmitCard";
    card.innerHTML = `
      <h2><span class="step">!</span>사전 제출 서류 <span class="req">먼저 제출</span></h2>
      <p class="hint" style="margin:0 0 8px">아래 서류는 캠프 시작 전에 <b>운영기관에 미리 제출</b>해야 합니다. 본 도구의 자동 작성 대상이 아니며, 받으신 원본 양식에 직접 작성하세요.</p>
      <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.9">
        <li><b>강사지원서</b> — 전 강사 공통 (소속·이름 기재)</li>
        <li><b>현직 교원 출강 확인서</b> — 현직 교원만 필수 제출</li>
        <li><b>성범죄·아동학대 부존재 서약서</b> — 전문강사·프리랜서 강사 필수</li>
        <li class="muted">제출 시 신분증 사본·통장 사본·개인정보 활용 동의서 함께 준비</li>
      </ul>`;
    const actionCard = document.querySelector(".action-card");
    if (actionCard && actionCard.parentNode) actionCard.parentNode.insertBefore(card, actionCard);
  }

  bind("gDlXlsx", "click", onDownloadXlsx);
  bind("gDlBanner", "click", onGachonBanner);
  bind("gDlEquip", "click", onGachonEquip);
  bind("gDlLectureMain", "click", () => onGachonLecture("주강사"));
  bind("gDlReport", "click", onGachonReport);
  bind("gDlMeal", "click", onGachonMeal);
  bind("gDlMaterial", "click", onGachonMaterial);
  bind("gDlLectureAssist", "click", () => onGachonLecture("보조강사"));
  bind("gDlWork", "click", onGachonWork);
}

// 가천대 버튼 활성화 갱신
function refreshGachonButtons(total) {
  const ready = !!(lastClasses && lastClasses.length);
  const t = (typeof total === "number") ? total
    : (lastClasses || []).reduce((n, c) => n + (c.rows ? c.rows.length : 0), 0);
  const hasMain = anyMainTeacher();
  const hasAssist = [...document.querySelectorAll('[id^="assist_"]')].some(i => i.value.trim())
    || !!(lastClasses && lastClasses.some(c => (c.settings || {}).assistantTeacher));
  const hasSafety = anySafetyManager();
  const set = (id, v) => { const el = $(id); if (el) el.disabled = v; };
  set("gDlXlsx", !(ready && t > 0));
  set("gDlBanner", !(ready && gBannerTemplateBuf));
  set("gDlEquip", !(ready && gEquipTemplateBuf && hasMain));
  set("gDlLectureMain", !(ready && gLectureTemplateBuf && hasMain));
  set("gDlReport", !(ready && gReportTemplateBuf));
  set("gDlMeal", !(ready && gMealTemplateBuf));
  set("gDlMaterial", !(ready && gMaterialTemplateBuf));
  set("gDlLectureAssist", !(ready && gLectureTemplateBuf && hasAssist));
  set("gDlWork", !(ready && gWorkTemplateBuf && hasSafety));
}

// 일자별 차시 부착: 일별 차시 = 총차시 / 일수
function daysWithChasi(st) {
  const ds = (st.days || []).filter(d => d && d.date);
  const nd = ds.length || 1;
  const per = (st.chasi || 0) / nd;
  return ds.map(d => ({ ...d, chasi: per }));
}
// 마지막 일자(전 클래스)
function lastDateOf(classes) {
  let last = null;
  for (const c of classes) for (const d of ((c.settings || {}).days || [])) {
    if (d.date && (!last || d.date.m * 100 + d.date.d > last.m * 100 + last.d)) last = d.date;
  }
  return last;
}

// 1) 교구 지급 보고서 (주강사) — 클래스별
async function onGachonEquip() {
  if (!lastClasses || !lastClasses.length || !gEquipTemplateBuf) return;
  for (const c of lastClasses) {
    const st = c.settings || {};
    if (!st.mainTeacher) {
      const v = prompt(`[${c.className}] 교구 지급 보고서의 주강사 성명을 입력하세요.`, "");
      if (v === null) return;
      st.mainTeacher = v.trim();
      const inp = $(`teacher_${cssId(c.className)}`); if (inp) inp.value = st.mainTeacher;
    }
  }
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i], st = c.settings || {};
    const blob = await buildGachonEquipHwpx(gEquipTemplateBuf, {
      program: st.program || c.program || "", school: c.school || "",
      mainTeacher: st.mainTeacher || "", equipQty: st.equipQty || "", days: st.days || []
    });
    triggerDownload(blob, `교구지급보고서_${ownerTag(st.mainTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 2) 식·다과 수령대장 (보조강사) — 클래스별, 실명
async function onGachonMeal() {
  if (!lastClasses || !lastClasses.length || !gMealTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i], st = c.settings || {};
    const blob = await buildGachonMealHwpx(gMealTemplateBuf, {
      program: st.program || c.program || "", school: c.school || "",
      names: c.realNames || [], mainTeacher: st.mainTeacher || "",
      assistantTeacher: st.assistantTeacher || "", days: st.days || []
    });
    triggerDownload(blob, `식다과수령대장_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 3) 교재·교구 수령대장 (보조강사) — 클래스별, 실명
async function onGachonMaterial() {
  if (!lastClasses || !lastClasses.length || !gMaterialTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i], st = c.settings || {};
    const blob = await buildGachonMaterialHwpx(gMaterialTemplateBuf, {
      program: st.program || c.program || "", school: c.school || "",
      names: c.realNames || [], assistantTeacher: st.assistantTeacher || "", days: st.days || []
    });
    triggerDownload(blob, `교재교구수령대장_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 4) 결과 보고서 (보조강사) — AI 추진의견 자동삽입, 클래스별
async function onGachonReport() {
  if (!lastClasses || !lastClasses.length || !gReportTemplateBuf) return;
  const program = (lastClasses[0].settings && lastClasses[0].settings.program) || lastClasses[0].program || "";
  setStatus("convertStatus", "AI 추진의견 생성 중…", "");
  const opinions = await ensureOpinions(program);
  setStatus("convertStatus", "결과 보고서 생성 중…", "");
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i], st = c.settings || {};
    const blob = await buildGachonReportHwpx(gReportTemplateBuf, {
      program: st.program || c.program || "", school: c.school || "",
      days: st.days || [], opinions
    });
    triggerDownload(blob, `결과보고서_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
  setStatus("convertStatus", Object.keys(opinions).length ? "결과 보고서 다운로드 완료 (AI 추진의견 포함)" : "결과 보고서 다운로드 완료 (AI 의견 생성 실패 — 빈칸)", "ok");
}

// 5) 강의 보고서 (주/보조강사) — 캠프 1부, 전 클래스의 일자를 실적 블록으로
async function onGachonLecture(role) {
  if (!lastClasses || !lastClasses.length || !gLectureTemplateBuf) return;
  const c0 = lastClasses[0], st0 = c0.settings || {};
  const idKey = role === "주강사" ? "mainTeacher" : "assistantTeacher";
  let name = "";
  for (const c of lastClasses) { const v = (c.settings || {})[idKey]; if (v) { name = v; break; } }
  if (!name) {
    const v = prompt(`강의 보고서(${role})의 성명을 입력하세요.`, "");
    if (v === null) return;
    name = v.trim();
  }
  // 전 클래스의 일자를 차시와 함께 모음(오전/오후 각 일자 = 1블록)
  const blocks = [];
  for (const c of lastClasses) blocks.push(...daysWithChasi(c.settings || {}));
  const blob = await buildGachonLectureHwpx(gLectureTemplateBuf, {
    program: st0.program || c0.program || "", school: c0.school || "",
    name, role, days: blocks
  });
  triggerDownload(blob, `강의보고서_${role}_${ownerTag(name)}.hwpx`);
}

// 6) 업무 보고서 (안전관리자) — 캠프 1부, 안전 정산(20,000/시간, 반별 1일 한도 60,000)
async function onGachonWork() {
  if (!lastClasses || !lastClasses.length || !gWorkTemplateBuf) return;
  const nm = ensureSafetyManager();
  if (nm === null) return;
  const c0 = lastClasses[0], st0 = c0.settings || {};
  const { total } = calcSafetyPay();
  const rounds = lastClasses.reduce((n, c) => n + ((c.settings || {}).days || []).filter(d => d.date).length, 0);
  const calcLine = `20,000원 X 시간 (반별 1일 한도 60,000원 적용) = ${total.toLocaleString()}원`;
  const blob = await buildGachonWorkHwpx(gWorkTemplateBuf, {
    program: st0.program || c0.program || "", school: c0.school || "",
    name: nm, days: (st0.days || []), totalAmount: total.toLocaleString(), rounds, calcLine
  });
  triggerDownload(blob, `업무보고서_${ownerTag(nm)}.hwpx`);
}

// 7) 캠프 배너 (pptx) — 학교명·일시 자동
async function onGachonBanner() {
  if (!lastClasses || !lastClasses.length || !gBannerTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i], st = c.settings || {};
    const ds = (st.days || []).map(d => d.date).filter(Boolean);
    const f = ds[0], l = ds[ds.length - 1];
    const dateText = (f && l)
      ? (f.m === l.m && f.d === l.d ? `2026.${f.m}.${f.d}` : `2026.${f.m}.${f.d} ~ ${l.m}.${l.d}`)
      : "";
    const blob = await buildGachonBanner(gBannerTemplateBuf, { school: c.school || "", dateText });
    triggerDownload(blob, `배너_${safeName(c.school || rosterName)}_${safeName(c.className)}.pptx`);
    if (i < lastClasses.length - 1) await sleep(350);
    // 클래스가 같은 학교면 1장만 충분하나, 클래스별 일시가 다를 수 있어 각각 생성
  }
}

// ---- 유틸 ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function safeName(s) { return (s || "").replace(/[\\/:*?"<>|]/g, "_"); }
// 담당자 이름이 있으면 그 이름으로, 없으면 명단 파일명으로 대체
function ownerTag(name) { const n = (name || "").trim(); return safeName(n || rosterName); }
function cssId(s) { return "c" + Array.from(s).reduce((a, ch) => ((a << 5) - a + ch.charCodeAt(0)) | 0, 0).toString(36).replace("-", "n"); }
function escHtml(s) { return (s ?? "").toString().replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }
function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
