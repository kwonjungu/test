import { RegionResolver, SIDO_LIST } from "./region.js";
import {
  parseRoster, toRegistrationRows, buildRegistrationXlsx,
  defaultChasi, fmtDate
} from "./convert.js";
import { buildReceiptHwpx, buildEquipmentLedgerHwpx } from "./hwpx.js";
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
  $("downloadEquipBtn").addEventListener("click", onDownloadEquip);
});

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
    const dates = blk.dates.length ? blk.dates : [{ m: 0, d: 0 }];
    const dayRows = dates.map((d, i) =>
      dayRowHtml(id, i, d.m ? fmtDate(d) : "", defStart, defEnd)).join("");
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
          <label>주강사 <input type="text" id="teacher_${id}" placeholder="주강사 성명" style="width:110px"></label>
          <label>교구 수량 <input type="number" id="qty_${id}" placeholder="개수" style="width:70px"></label>
        </div>
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
  }
  host.style.display = blocks.length ? "block" : "none";
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
  const total = lastClasses.reduce((n, c) => n + c.rows.length, 0);
  $("downloadBtn").disabled = total === 0;
  $("downloadHwpxBtn").disabled = total === 0 || !hwpxTemplateBuf;
  $("downloadEquipBtn").disabled = total === 0 || !equipTemplateBuf;
  setStatus("convertStatus",
    `변환 완료: ${lastClasses.length}개 클래스 / 학생 ${total}명`, "ok");
}

function renderPreview(classes) {
  $("meta").innerHTML = classes
    .map(c => `<b>${escHtml(c.className)}</b>: ${escHtml(c.school)} / ${escHtml(c.program)} (${c.rows.length}명)`)
    .join("<br>");

  const allLog = classes.flatMap(c => c.regionLog);
  const unresolved = [...new Set(allLog.filter(r => !r.sido).map(r => r.school))];
  if (unresolved.length) {
    $("warn").innerHTML = `⚠ 지역 미확인 학교: <b>${unresolved.join(", ")}</b> — 학교 검색/드롭다운으로 선택 후 다시 변환하세요.`;
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
    triggerDownload(blob, `교구관리대장_${safeName(rosterName)}_${safeName(c.className)}.hwpx`);
    if (i < lastClasses.length - 1) await sleep(350);
  }
}

// ---- 유틸 ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function safeName(s) { return (s || "").replace(/[\\/:*?"<>|]/g, "_"); }
function cssId(s) { return "c" + Array.from(s).reduce((a, ch) => ((a << 5) - a + ch.charCodeAt(0)) | 0, 0).toString(36).replace("-", "n"); }
function escHtml(s) { return (s ?? "").toString().replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])); }
function escAttr(s) { return escHtml(s).replace(/"/g, "&quot;"); }

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
