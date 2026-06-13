import { RegionResolver, SIDO_LIST } from "./region.js";
import { parseRoster, toRegistrationRows, buildRegistrationXlsx } from "./convert.js";

const $ = (id) => document.getElementById(id);
const resolver = new RegionResolver();
let templateBuf = null;     // 양식 ArrayBuffer
let lastRows = null;        // 변환된 행
let rosterBuf = null;

window.addEventListener("DOMContentLoaded", async () => {
  await resolver.loadBundle();
  // 기본 양식 템플릿 미리 로드
  try {
    const res = await fetch("templates/수업신청학생등록양식.xlsx");
    templateBuf = await res.arrayBuffer();
    setStatus("templateStatus", "기본 양식 템플릿 로드됨", "ok");
  } catch (e) {
    setStatus("templateStatus", "기본 양식을 못 불러옴 — 직접 업로드하세요", "warn");
  }

  $("rosterFile").addEventListener("change", onRoster);
  $("templateFile").addEventListener("change", onTemplate);
  $("dbFile").addEventListener("change", onDb);
  $("neisKey").addEventListener("change", e => resolver.neisKey = e.target.value.trim());
  $("convertBtn").addEventListener("click", onConvert);
  $("downloadBtn").addEventListener("click", onDownload);
});

function setStatus(id, msg, cls = "") {
  const el = $(id); if (!el) return;
  el.textContent = msg; el.className = "status " + cls;
}

async function onRoster(e) {
  const f = e.target.files[0]; if (!f) return;
  rosterBuf = await f.arrayBuffer();
  setStatus("rosterStatus", `명단 로드됨: ${f.name}`, "ok");
}
async function onTemplate(e) {
  const f = e.target.files[0]; if (!f) return;
  templateBuf = await f.arrayBuffer();
  setStatus("templateStatus", `양식 교체됨: ${f.name}`, "ok");
}
async function onDb(e) {
  const f = e.target.files[0]; if (!f) return;
  const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
  let learned = 0;
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: "" });
    learned += resolver.learnFromDb(rows);
  }
  setStatus("dbStatus", `원DB 학습: ${learned}건 학교명 확보`, "ok");
}

async function onConvert() {
  if (!rosterBuf) { alert("캠프명단을 먼저 업로드하세요"); return; }
  if (!templateBuf) { alert("양식 템플릿이 없습니다"); return; }
  setStatus("convertStatus", "변환 중…", "");

  const wb = XLSX.read(rosterBuf, { type: "array" });
  const blocks = parseRoster(wb);
  const { rows, regionLog } = await toRegistrationRows(blocks, resolver);
  lastRows = rows;

  renderPreview(rows, regionLog, blocks);
  $("downloadBtn").disabled = rows.length === 0;
  setStatus("convertStatus", `변환 완료: 학생 ${rows.length}명`, "ok");
}

function renderPreview(rows, regionLog, blocks) {
  const meta = blocks.map(b => `${b.sheet}: ${b.school} / ${b.program} (${b.students.length}명)`).join("<br>");
  $("meta").innerHTML = meta;

  // 지역 미해결 경고
  const unresolved = [...new Set(regionLog.filter(r => !r.sido).map(r => r.school))];
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
  let html = "<table><thead><tr>" + head.map(h => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
  for (const r of rows) {
    html += "<tr>" + head.map(h => `<td>${r[h] || ""}</td>`).join("") + "</tr>";
  }
  html += "</tbody></table>";
  $("preview").innerHTML = html;
}

async function onDownload() {
  if (!lastRows) return;
  const blob = await buildRegistrationXlsx(templateBuf, lastRows);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "수업신청학생등록양식_작성본.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
