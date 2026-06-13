import { RegionResolver, SIDO_LIST } from "./region.js";
import {
  parseRoster, toRegistrationRows, buildRegistrationXlsx,
  defaultChasi, fmtDate, parseSchedule, programCore
} from "./convert.js";
import { buildReceiptHwpx, buildEquipmentLedgerHwpx, buildReportHwpx, buildSafetyLogHwpx, buildChecklistHwpx, buildPayApplicationHwpx, buildSafetyPayHwpx, buildSafetyContractHwpx, buildMulticulturalConfirmHwpx, buildCaseBookHwpx, buildSafetyPledgeHwpx } from "./hwpx.js";
import { NEIS_API_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);
const resolver = new RegionResolver();
resolver.neisKey = NEIS_API_KEY;

// 프로그램 목록 (드롭다운)
const PROGRAMS = [
  "(기본/초저) 노벨엔지니어링으로 만드는 안전한 등굣길",
  "(기본/초저) Eco 모빌리티, 멈춰버린 도시를 구하라!",
  "(기본/초고) 이동의 권리를 보장하는 배리어프리 레이스",
  "(기본/고등) AI로 꿈꾸는 Auto 디자인 스튜디오",
  "(AI특화/초고) 로봇이 그리는 로-그-인 스마트시티",
  "(특화/다문화) 드론 모빌리티, 작전명 빛글!",
  "(AI특화/중등) AI 로보택시를 연구하는 오픈랩"
];
const ORGS = ["대림대학교", "가천대학교"];

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
let parsedBlocks = null;       // parseRoster 결과 (실명 포함)
let lastClasses = null;        // 변환된 등록양식 결과
let rosterBuf = null;
let rosterName = "명단";

window.addEventListener("DOMContentLoaded", async () => {
  await resolver.loadBundle();
  resolver.loadProgramDb().then(info => {
    setStatus("dbStatus",
      `원DB 내장됨 — 참고 학교 ${info.schools}개 / 학급 ${info.classes}건`,
      info.schools ? "ok" : "warn");
  });

  // 템플릿 백그라운드 로드 (등록양식 xlsx + 수령대장 hwpx + 교구관리대장 hwpx)
  fetch("templates/수업신청학생등록양식.xlsx").then(r => r.arrayBuffer())
    .then(b => { xlsxTemplateBuf = b; }).catch(() => {});
  fetch("templates/수령대장양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { hwpxTemplateBuf = b; }).catch(() => {});
  fetch("templates/교구관리대장양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { equipTemplateBuf = b; }).catch(() => {});
  fetch("templates/결과보고서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { reportTemplateBuf = b; }).catch(() => {});
  fetch("templates/안전업무일지양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { safetyTemplateBuf = b; }).catch(() => {});
  fetch("templates/안전체크리스트양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { checklistTemplateBuf = b; }).catch(() => {});
  fetch("templates/강사료지급신청서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { payTemplateBuf = b; }).catch(() => {});
  fetch("templates/주강사료지급신청서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { juPayTemplateBuf = b; }).catch(() => {});
  fetch("templates/안전단기근로자지급신청서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { safetyPayTemplateBuf = b; }).catch(() => {});
  fetch("templates/안전단기근로계약서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { safetyContractTemplateBuf = b; }).catch(() => {});
  fetch("templates/다문화학교장확인서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { multiTemplateBuf = b; }).catch(() => {});
  fetch("templates/프로그램운영사례집양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { caseTemplateBuf = b; }).catch(() => {});
  fetch("templates/안전관리서약서양식.hwpx").then(r => r.arrayBuffer())
    .then(b => { pledgeTemplateBuf = b; }).catch(() => {});

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

  $("rosterFile").addEventListener("change", onRoster);
  $("schoolSearchBtn").addEventListener("click", onSchoolSearch);
  $("schoolSearch").addEventListener("keydown", e => { if (e.key === "Enter") onSchoolSearch(); });
  $("convertBtn").addEventListener("click", onConvert);
  $("downloadBtn").addEventListener("click", onDownloadXlsx);
  $("downloadHwpxBtn").addEventListener("click", onDownloadHwpx);
  $("downloadHwpx2Btn").addEventListener("click", onDownloadHwpx);
  $("downloadEquipBtn").addEventListener("click", onDownloadEquip);
  $("downloadReportBtn").addEventListener("click", onDownloadReport);
  $("downloadSafetyBtn").addEventListener("click", onDownloadSafety);
  $("downloadChecklistBtn").addEventListener("click", onDownloadChecklist);
  $("downloadPayBtn").addEventListener("click", onDownloadPay);
  $("downloadJuPayBtn").addEventListener("click", onDownloadJuPay);
  $("downloadSafetyPayBtn").addEventListener("click", onDownloadSafetyPay);
  $("downloadSafetyContractBtn").addEventListener("click", onDownloadSafetyContract);
  $("downloadMultiBtn").addEventListener("click", onDownloadMulti);
  $("downloadCaseBtn").addEventListener("click", onDownloadCase);
  $("downloadPledgeBtn").addEventListener("click", onDownloadPledge);
  $("shareBtn").addEventListener("click", onShareSave);
  $("aiBtn").addEventListener("click", onGenOpinions);

  // 공유 코드 링크로 열렸으면 저장된 세팅 자동 불러오기
  tryLoadFromPath();
});

// AI 추진의견(주강사/보조강사/안전관리자) — Gemini 호출, 복사용 텍스트 표시
async function onGenOpinions() {
  if (!lastClasses || !lastClasses.length) { alert("먼저 변환하세요."); return; }
  const c0 = lastClasses[0];
  const program = (c0.settings && c0.settings.program) || c0.program || "";
  const school = c0.school || "";
  const roles = ["주강사", "보조강사", "안전관리자"];
  setStatus("aiResult", "생성 중… (수초 소요)", "");
  try {
    const results = await Promise.all(roles.map(async (role) => {
      const r = await fetch("/api/opinion", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program, role, school })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      return { role, text: j.text || "" };
    }));
    $("aiResult").className = "status ok";
    $("aiResult").innerHTML = results.map(x =>
      `<div style="margin-top:6px"><b>${x.role}</b>
       <textarea readonly rows="3" style="width:100%;margin-top:2px">${x.text.replace(/</g, "&lt;")}</textarea></div>`
    ).join("");
  } catch (e) {
    setStatus("aiResult", `생성 실패: ${e.message} — Vercel + GEMINI_API_KEY 설정 후 동작합니다.`, "warn");
  }
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
    renderPreview(lastClasses);
    refreshDownloadButtons();
    if ($("shareCode")) $("shareCode").value = code;
    setStatus("convertStatus", `코드 '${code}' 불러옴 — 아래에서 서류를 바로 다운로드하세요.`, "ok");
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

// 명단 업로드 → 즉시 파싱 → 편집 가능한 설정 패널 표시
async function onRoster(e) {
  const f = e.target.files[0]; if (!f) return;
  rosterBuf = await f.arrayBuffer();
  rosterName = f.name.replace(/\.xlsx$/i, "");
  const wb = XLSX.read(rosterBuf, { type: "array" });
  parsedBlocks = parseRoster(wb).filter(b => b.students.length);
  setStatus("rosterStatus",
    `명단 로드됨: ${f.name} — 클래스 ${parsedBlocks.length}개`, "ok");
  renderSettings(parsedBlocks);
}

// 프로그램명 매칭(부분일치)으로 드롭다운 기본값 찾기
function matchProgram(prog) {
  const p = (prog || "").replace(/\s/g, "");
  return PROGRAMS.find(opt => {
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
  for (const blk of blocks) {
    const id = cssId(blk.sheet);
    const chasi = defaultChasi(blk.courseType);
    const selProg = matchProgram(blk.program);
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
    const progOpts = PROGRAMS.map(p =>
      `<option${p === selProg ? " selected" : ""}>${escHtml(p)}</option>`).join("");
    const orgOpts = ORGS.map(o => `<option>${o}</option>`).join("");

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
    // 담당자 입력 변화 → 담당자 필요 버튼 게이팅 갱신
    $(`teacher_${id}`).addEventListener("input", updateGatedBtns);
    $(`safety_${id}`).addEventListener("input", updateGatedBtns);
  }
  host.style.display = blocks.length ? "block" : "none";
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
  const ready = !!(lastClasses && lastClasses.length);
  const hasMain = anyMainTeacher();
  const hasSafety = anySafetyManager();
  $("downloadEquipBtn").disabled = !(ready && equipTemplateBuf && hasMain);
  $("downloadJuPayBtn").disabled = !(ready && juPayTemplateBuf && hasMain);
  $("downloadSafetyPayBtn").disabled = !(ready && safetyPayTemplateBuf && hasSafety);
  $("downloadSafetyContractBtn").disabled = !(ready && safetyContractTemplateBuf && hasSafety);
  $("downloadPledgeBtn").disabled = !(ready && pledgeTemplateBuf && hasSafety);
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

  lastClasses = await toRegistrationRows(parsedBlocks, resolver, { socialByClass });
  // 설정(차시/날짜/시간/기관/주강사/교구수량)·학교·실명을 클래스 결과에 부착
  for (const c of lastClasses) {
    const blk = parsedBlocks.find(b => b.sheet === c.className);
    c.settings = settings[c.className] || {};
    c.school = blk ? blk.school : c.school;
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

  const allLog = classes.flatMap(c => c.regionLog);
  const unresolved = [...new Set(allLog.filter(r => !r.sido).map(r => r.school))];
  if (unresolved.length) {
    // 명단의 실제 학교명에 직접 시·도를 지정 → 즉시 적용
    let h = `⚠ 지역 미확인 학교 — 시·도를 지정하면 바로 반영됩니다:`;
    unresolved.forEach((sc, idx) => {
      const opts = SIDO_LIST.map(s => `<option>${s}</option>`).join("");
      h += `<div class="row" style="margin-top:4px">
        <b>${escHtml(sc)}</b>
        <select class="fixSido" data-school="${escAttr(sc)}"><option value="">— 선택 —</option>${opts}</select></div>`;
    });
    h += `<button id="applyFix" style="margin-top:6px">선택한 지역 적용</button>`;
    $("warn").innerHTML = h;
    $("applyFix").onclick = () => {
      document.querySelectorAll(".fixSido").forEach(sel => {
        if (sel.value) resolver.learn(sel.dataset.school, sel.value);  // 실제 학교명에 매핑
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

// 결과보고서 hwpx (보조강사 취합 서류) — 클래스별 개별 다운로드
async function onDownloadReport() {
  if (!lastClasses || !lastClasses.length || !reportTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const blob = await buildReportHwpx(reportTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      org: st.org || "",
      days: st.days || [],
      year: 2026
    });
    triggerDownload(blob, `결과보고서_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// 프로그램 운영 사례집 hwpx — 클래스별 (프로그램/장소/일시 자동, 후기 본문은 수기)
async function onDownloadCase() {
  if (!lastClasses || !lastClasses.length || !caseTemplateBuf) return;
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const st = c.settings || {};
    const blob = await buildCaseBookHwpx(caseTemplateBuf, {
      program: st.program || c.program || "",
      school: c.school || "",
      days: st.days || [],
      year: 2026
    });
    triggerDownload(blob, `프로그램운영사례집_${ownerTag(st.assistantTeacher)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
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

  // 클래스별 산출내역 줄 + 총차시 + 마지막일
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

  const blob = await buildPayApplicationHwpx(payTemplateBuf, {
    program: (c0.settings && c0.settings.program) || c0.program || "",
    school: c0.school || "",
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
