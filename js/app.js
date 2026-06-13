import { RegionResolver, SIDO_LIST } from "./region.js";
import { parseRoster, toRegistrationRows, buildRegistrationXlsx } from "./convert.js";
import { NEIS_API_KEY } from "./config.js";

const $ = (id) => document.getElementById(id);
const resolver = new RegionResolver();
resolver.neisKey = NEIS_API_KEY;   // 키를 코드에 미리 설정 (사용자 입력 불필요)
let templateBuf = null;     // 양식 ArrayBuffer
let lastClasses = null;     // 변환된 클래스별 결과 [{className, rows, ...}]
let rosterBuf = null;
let rosterName = "명단";

window.addEventListener("DOMContentLoaded", async () => {
  await resolver.loadBundle();
  // 원DB(모집현황) 비PII 참고데이터를 백그라운드로 내장 로드
  resolver.loadProgramDb().then(info => {
    setStatus("dbStatus",
      `원DB 내장됨 — 참고 학교 ${info.schools}개 / 학급 ${info.classes}건`,
      info.schools ? "ok" : "warn");
  });
  // 기본 양식 템플릿 미리 로드
  try {
    const res = await fetch("templates/수업신청학생등록양식.xlsx");
    templateBuf = await res.arrayBuffer();
    setStatus("templateStatus", "기본 양식 템플릿 로드됨", "ok");
  } catch (e) {
    setStatus("templateStatus", "기본 양식을 못 불러옴 — 직접 업로드하세요", "warn");
  }

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
      resolver.learn(name, sidoSel.value);   // 수동 선택도 변환에 반영
      setStatus("schoolStatus", `${name} → ${sidoSel.value} (수동 선택)`, "ok");
    }
  });

  // 지역 자동조회 안내 (NEIS는 키 없이 동작)
  setStatus("neisStatus",
    "NEIS 자동조회 사용 중 — 학교명으로 전국 학교의 지역이 자동 입력됩니다." +
    (resolver.neisKey ? " (API 키 적용)" : ""), "ok");

  $("rosterFile").addEventListener("change", onRoster);
  $("templateFile").addEventListener("change", onTemplate);
  $("schoolSearchBtn").addEventListener("click", onSchoolSearch);
  $("schoolSearch").addEventListener("keydown", e => { if (e.key === "Enter") onSchoolSearch(); });
  $("convertBtn").addEventListener("click", onConvert);
  $("downloadBtn").addEventListener("click", onDownload);
});

// 학교 검색 → 지역 자동조회 후 드롭다운 자동선택
async function onSchoolSearch() {
  const name = $("schoolSearch").value.trim();
  if (!name) return;
  setStatus("schoolStatus", "조회 중…", "");
  const reg = await resolver.resolve(name);
  const sel = $("schoolSido");
  if (reg.sido) {
    sel.value = reg.sido;                 // 드롭다운 자동선택
    resolver.learn(name, reg.sido);       // 변환에도 반영되도록 학습
    setStatus("schoolStatus", `${name} → ${reg.sido} (출처: ${reg.source})`, "ok");
  } else {
    setStatus("schoolStatus", `${name}: 자동조회 실패 — 아래 드롭다운에서 직접 선택하세요.`, "warn");
  }
}

function setStatus(id, msg, cls = "") {
  const el = $(id); if (!el) return;
  el.textContent = msg; el.className = "status " + cls;
}

async function onRoster(e) {
  const f = e.target.files[0]; if (!f) return;
  rosterBuf = await f.arrayBuffer();
  rosterName = f.name.replace(/\.xlsx$/i, "");
  setStatus("rosterStatus", `명단 로드됨: ${f.name}`, "ok");
}
async function onTemplate(e) {
  const f = e.target.files[0]; if (!f) return;
  templateBuf = await f.arrayBuffer();
  setStatus("templateStatus", `양식 교체됨: ${f.name}`, "ok");
}
async function onConvert() {
  if (!rosterBuf) { alert("캠프명단을 먼저 업로드하세요"); return; }
  if (!templateBuf) { alert("양식 템플릿이 없습니다"); return; }
  setStatus("convertStatus", "변환 중…", "");

  const wb = XLSX.read(rosterBuf, { type: "array" });
  const blocks = parseRoster(wb);
  lastClasses = await toRegistrationRows(blocks, resolver);

  renderPreview(lastClasses);
  const total = lastClasses.reduce((n, c) => n + c.rows.length, 0);
  $("downloadBtn").disabled = total === 0;
  $("downloadBtn").textContent = lastClasses.length > 1
    ? `등록양식 ${lastClasses.length}개 파일 개별 다운로드` : "등록양식 다운로드";
  setStatus("convertStatus",
    `변환 완료: ${lastClasses.length}개 클래스 / 학생 ${total}명`, "ok");
}

function renderPreview(classes) {
  $("meta").innerHTML = classes
    .map(c => `<b>${c.className}</b>: ${c.school} / ${c.program} (${c.rows.length}명)`)
    .join("<br>");

  // 지역 미해결 경고 (전체 클래스 합산)
  const allLog = classes.flatMap(c => c.regionLog);
  const unresolved = [...new Set(allLog.filter(r => !r.sido).map(r => r.school))];
  if (unresolved.length) {
    $("warn").innerHTML = `⚠ 지역 미확인 학교: <b>${unresolved.join(", ")}</b> — NEIS 키를 입력하거나 수동 선택하세요.<br>` +
      `<select id="manualSido">${SIDO_LIST.map(s => `<option>${s}</option>`).join("")}</select> ` +
      `<button id="applySido">미확인 전체에 적용</button>`;
    $("applySido").onclick = () => {
      const sido = $("manualSido").value;
      unresolved.forEach(sc => resolver.learn(sc, sido));
      onConvert();
    };
  } else {
    $("warn").innerHTML = "";
  }

  const head = ["학생명","연락처","이메일","지역","학교","학년","반","일반학생 여부"];
  let html = "";
  for (const c of classes) {
    html += `<h3 class="cls">${c.className} (${c.rows.length}명)</h3>`;
    html += "<table><thead><tr>" + head.map(h => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
    for (const r of c.rows) {
      html += "<tr>" + head.map(h => `<td>${r[h] || ""}</td>`).join("") + "</tr>";
    }
    html += "</tbody></table>";
  }
  $("preview").innerHTML = html;
}

function safeName(s) { return (s || "").replace(/[\\/:*?"<>|]/g, "_"); }

async function onDownload() {
  if (!lastClasses || !lastClasses.length) return;

  // 클래스(오전반/오후반)별 파일을 개별로 다운로드 (ZIP 없음)
  for (let i = 0; i < lastClasses.length; i++) {
    const c = lastClasses[i];
    const blob = await buildRegistrationXlsx(templateBuf, c.rows);
    const name = `수업신청학생등록양식_${safeName(rosterName)}_${safeName(c.className)}.xlsx`;
    triggerDownload(blob, name);
    if (i < lastClasses.length - 1) await sleep(350);  // 연속 다운로드 차단 방지
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
