// 가천대학교 디지털새싹 양식 hwpx 생성기 (의존: 전역 JSZip)
//
// 가천대 양식은 자리표시자(플레이스홀더)가 박힌 빈 양식이다.
//  - 공통 머리: "한국과학창의재단/ 가천대학교/ 증안초등학교"(운영기관), "프로그램명"/"프로그램명 작성해주세요"
//  - 책임자 "민홍", 제출처 "가천대학교 산학협력단"은 고정(치환 안 함)
// 처리 방식은 대림대 hwpx.js와 동일하게 "텍스트 노드 문자열 치환" + "표 셀 빈칸 주입".
// 산출/금액 규칙(요청 확정):
//  - 강의보고서: 주강사 75,000원/시간, 보조강사 45,000원/시간. 일자별 실적 4블록.
//  - 업무보고서(안전): 20,000원/시간, 4회를 1블록에 합산(한도 적용 표기 유지).
// AI 추진의견은 결과보고서에만 들어간다(대림대 로직과 동일, 4번째 운영기관 칸은 비움).

function xmlEsc(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const pad2 = (n) => String(n).padStart(2, "0");
const rgEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function fmtTime(s) {
  const m = (s || "").match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  return m ? `${pad2(m[1])}:${pad2(m[2])}` : "09:00";
}
// "HH:MM"을 시간(소수)으로: 09:00~12:10 → 3.17 (반올림 없이 비교용)
function hoursBetween(start, end) {
  const a = (start || "").match(/(\d{1,2}):(\d{2})/), b = (end || "").match(/(\d{1,2}):(\d{2})/);
  if (!a || !b) return 0;
  return (+b[1] * 60 + +b[2] - (+a[1] * 60 + +a[2])) / 60;
}

// 텍스트 노드 정확매칭 치환 (모든 출현)
function replaceText(xml, oldText, newText) {
  if (oldText == null || newText == null) return xml;
  return xml.replace(new RegExp(`<hp:t>${rgEsc(oldText)}</hp:t>`, "g"), `<hp:t>${xmlEsc(newText)}</hp:t>`);
}
// 한 run 안의 텍스트 일부를 부분 치환(공백 폭 등 보존). run 단위로 매칭.
function replaceInRun(xml, contains, transform) {
  return xml.replace(new RegExp(`<hp:run\\b[^>]*><hp:t>([^<]*${rgEsc(contains)}[^<]*)</hp:t></hp:run>`, "g"),
    (m, t) => m.replace(`<hp:t>${t}</hp:t>`, `<hp:t>${xmlEsc(transform(t))}</hp:t>`));
}

// ---------- 공통 패키징 (대림대 hwpx.js와 동일 규칙) ----------
async function packageHwpx(zip) {
  let hadScripts = false;
  for (const k of Object.keys(zip.files)) {
    if (/^Scripts\//.test(k)) { delete zip.files[k]; hadScripts = true; }
  }
  if (hadScripts && zip.file("Contents/content.hpf")) {
    let hpf = await zip.file("Contents/content.hpf").async("string");
    hpf = hpf.replace(/<opf:item\b[^>]*\bid="(?:headersc|sourcesc)"[^>]*\/>/g, "");
    hpf = hpf.replace(/<opf:itemref\b[^>]*\bidref="(?:headersc|sourcesc)"[^>]*\/>/g, "");
    zip.file("Contents/content.hpf", hpf);
  }
  const mt = await zip.file("mimetype").async("uint8array");
  zip.file("mimetype", mt, { compression: "STORE" });
  for (const k of Object.keys(zip.files)) if (zip.files[k].dir) delete zip.files[k];
  return await zip.generateAsync({
    type: "blob", mimeType: "application/hwp+zip",
    compression: "DEFLATE", compressionOptions: { level: 9 }
  });
}

async function loadSection(templateBuf) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  const xml = await zip.file(path).async("string");
  return { zip, path, xml };
}

// 공통 머리 치환: 운영기관(학교)·프로그램명
// data: { program, school }
function fillCommonHead(xml, data) {
  if (data.school) {
    // "한국과학창의재단/ 가천대학교/ 증안초등학교" 의 마지막 학교만 교체
    xml = replaceInRun(xml, "한국과학창의재단/ 가천대학교/",
      (t) => t.replace(/(한국과학창의재단\/\s*가천대학교\/\s*).*/, `$1 ${data.school}`));
  }
  if (data.program) {
    xml = replaceText(xml, "프로그램명 작성해주세요", data.program);
    // 머리표의 값칸 "프로그램명"(라벨이 아닌 값 자리)도 채움 — charPrIDRef 20(값) 우선
    xml = xml.replace(/<hp:run charPrIDRef="20"><hp:t>프로그램명<\/hp:t><\/hp:run>/g,
      `<hp:run charPrIDRef="20"><hp:t>${xmlEsc(data.program)}</hp:t></hp:run>`);
  }
  return xml;
}

// 운영기간/수령일시 등 날짜 치환 (양식 박힌 기준값 → 실제 일정)
// 기준값: 운영기간 "2026년 06월 20일 ~ 06월 21일", 수령일시 "2026년 6월 20일 09:00~12:10"
function fillDates(xml, days) {
  const ds = (days || []).filter(d => d && d.date);
  if (!ds.length) return xml;
  const f = ds[0], l = ds[ds.length - 1];
  const t0 = `${fmtTime(f.start)}~${fmtTime(f.end)}`;
  // 운영기간 (+시간 변형 먼저)
  xml = replaceText(xml, `2026년 ${pad2(f.date.m)}월 ${pad2(f.date.d)}일 ~ ${pad2(l.date.m)}월 ${pad2(l.date.d)}일`,
    `2026년 ${pad2(f.date.m)}월 ${pad2(f.date.d)}일 ~ ${pad2(l.date.m)}월 ${pad2(l.date.d)}일`); // no-op 보호
  xml = replaceInRun(xml, "2026년 06월 20일 ~ 06월 21일",
    (t) => t.replace(/2026년 06월 20일 ~ 06월 21일/, `2026년 ${pad2(f.date.m)}월 ${pad2(f.date.d)}일 ~ ${pad2(l.date.m)}월 ${pad2(l.date.d)}일`));
  // 수령일시 "2026년 6월 20일 09:00~12:10" → 시작일+시간
  xml = replaceInRun(xml, "2026년 6월 20일 09:00",
    () => `2026년 ${f.date.m}월 ${f.date.d}일 ${t0} `);
  // 식다과: 회차별 지급일 "(1회 지급일) 6월 20일 09:00~12:10", "(2회 지급일) 6월 21일 ..."
  xml = replaceInRun(xml, "(1회 지급일) 6월 20일",
    () => `(1회 지급일) ${f.date.m}월 ${f.date.d}일 ${t0} `);
  if (ds[1]) {
    const s = ds[1];
    xml = replaceInRun(xml, "(2회 지급일) 6월 21일",
      () => `(2회 지급일) ${s.date.m}월 ${s.date.d}일 ${fmtTime(s.start)}~${fmtTime(s.end)} `);
  }
  // 교구지급 제출일 "2026. 06. 21." (마지막일)
  xml = replaceText(xml, `2026. ${pad2(6)}. ${pad2(21)}.`, `2026. ${pad2(l.date.m)}. ${pad2(l.date.d)}.`);
  return xml;
}

// 학생 실명 주입 (colAddr="1" rowAddr=9~28의 "홍길동" 플레이스홀더 교체, 남으면 비움)
function fillReceiptNames(xml, names) {
  let idx = 0;
  return xml.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    const a = tc.match(/colAddr="1" rowAddr="(\d+)"/);
    if (!a) return tc;
    const row = +a[1];
    if (row < 9 || row > 28) return tc;
    if (!/홍길동/.test(tc)) return tc;
    const nm = names[idx] || "";
    idx++;
    return tc.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>홍길동<\/hp:t><\/hp:run>/,
      (m, cid) => nm ? `<hp:run charPrIDRef="${cid}"><hp:t>${xmlEsc(nm)}</hp:t></hp:run>`
                     : `<hp:run charPrIDRef="${cid}"><hp:t></hp:t></hp:run>`);
  });
}

// ===== 1) 교구 지급 보고서 (주강사) =====
// data: { program, school, mainTeacher, equipQty, days }
export async function buildGachonEquipHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  xml = fillCommonHead(xml, data);
  xml = fillDates(xml, data.days);
  if (data.equipQty) xml = replaceText(xml, "00", `${data.equipQty}`);
  if (data.mainTeacher) xml = replaceInRun(xml, "캠프 운영 교사/ 강사  홍길동",
    () => `캠프 운영 교사/ 강사  ${data.mainTeacher} (인)`);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 2) 식다과 수령대장 (보조강사) =====
// data: { program, school, names, mainTeacher, assistantTeacher, days }
export async function buildGachonMealHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  xml = fillCommonHead(xml, data);
  xml = fillDates(xml, data.days);
  xml = fillReceiptNames(xml, data.names || []);
  // 확인자/주강사/보조강사 (김원지=확인자·보조, 김수민=주강사)
  if (data.assistantTeacher) {
    xml = replaceInRun(xml, "김원지", (t) => t.replace(/김원지/, data.assistantTeacher));
  }
  if (data.mainTeacher) xml = replaceText(xml, "김수민", data.mainTeacher);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 3) 교재/교구 수령대장 (보조강사) =====
// data: { program, school, names, assistantTeacher, days }
export async function buildGachonMaterialHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  xml = fillCommonHead(xml, data);
  xml = fillDates(xml, data.days);
  xml = fillReceiptNames(xml, data.names || []);
  if (data.assistantTeacher) xml = replaceInRun(xml, "김원지", (t) => t.replace(/김원지/, data.assistantTeacher));
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 4) 결과보고서 (보조강사) — AI 추진의견 4칸 중 주/보조/안전 =====
// data: { program, school, days, opinions:{주강사,보조강사,안전관리자} }
// 추진의견 칸은 라벨 단락(▶ (○○ 작성용))과 같은 셀/다음 셀 구조. 대림대와 동일 접근.
function fillGachonOpinions(xml, opinions) {
  const ops = opinions || {};
  // 각 라벨 단락 다음 행에 비어 있는 작성칸(자체닫힘 빈 run)이 있다. 라벨 뒤 첫 빈 run에 주입.
  const labels = { "주강사": "(주강사 작성용)", "보조강사": "(보조강사 작성용)", "안전관리자": "(안전관리자 작성용)" };
  for (const role of Object.keys(labels)) {
    const text = (ops[role] || "").trim();
    if (!text) continue;
    const li = xml.indexOf(labels[role]);
    if (li < 0) continue;
    // 라벨 위치 이후의 첫 빈 run: <hp:run charPrIDRef="N"/> (자체닫힘) 또는 <hp:run ...><hp:t></hp:t></hp:run>
    const after = xml.slice(li);
    const m = after.match(/<hp:run charPrIDRef="(\d+)"\/>|<hp:run charPrIDRef="(\d+)"><hp:t><\/hp:t><\/hp:run>/);
    if (!m) continue;
    const cid = m[1] || m[2];
    const repl = `<hp:run charPrIDRef="${cid}"><hp:t>${xmlEsc(text)}</hp:t></hp:run>`;
    xml = xml.slice(0, li) + after.replace(m[0], repl);
  }
  return xml;
}
export async function buildGachonReportHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  xml = fillCommonHead(xml, data);
  xml = fillDates(xml, data.days);
  if (data.opinions) xml = fillGachonOpinions(xml, data.opinions);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 5) 강의보고서 (주/보조강사) =====
// 실적 4블록: 강의일자/횟수(1회)/강사료/산출내역(1회 X N시간 X 단가). 일자별로 채우고 남으면 비움.
// data: { program, school, name, role:"주강사"|"보조강사", days, lastDate }
const LECTURE_UNIT = { "주강사": 75000, "보조강사": 45000 };
export async function buildGachonLectureHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const unit = LECTURE_UNIT[data.role] || 75000;
  const ds = (data.days || []).filter(d => d && d.date);

  // 블록 키: 양식엔 "2026-06-28 09:00 ~ 06-28 12:10"(일자), "1회", "300,000"(강사료), "1회 X 4시간 X 75,000원 = 300,000원"
  // 4개 블록을 순서대로 days로 치환. run 단위 부분치환으로 처리(각 블록 동일 텍스트라 순차 교체).
  const fmtDate = (d) => `2026-${pad2(d.date.m)}-${pad2(d.date.d)} ${fmtTime(d.start)} ~ ${pad2(d.date.m)}-${pad2(d.date.d)} ${fmtTime(d.end)}`;
  // 일자별 차시(시간) — days[i].chasi 우선, 없으면 시계시간 반올림(최소 1)
  const blockHours = ds.map(d => d.chasi || Math.round(hoursBetween(d.start, d.end)) || 4);
  const blockAmts = blockHours.map(h => h * unit);   // 시간당 단가 × 차시
  // 순차 교체 헬퍼: 같은 플레이스홀더 텍스트를 앞에서부터 1개씩 교체
  function seqReplace(text, makeNew) {
    let i = 0;
    return xml.replace(new RegExp(`<hp:t>${rgEsc(text)}</hp:t>`, "g"), (m) => {
      const r = makeNew(i, m); i++; return r;
    });
  }
  // 일자 (4블록 동일)
  xml = seqReplace("2026-06-28 09:00 ~ 06-28 12:10", (i) =>
    i < ds.length ? `<hp:t>${xmlEsc(fmtDate(ds[i]))}</hp:t>` : `<hp:t></hp:t>`);
  // 산출내역 "1회 X 4시간 X 75,000원 = 300,000원"
  xml = seqReplace("1회 X 4시간 X 75,000원 = 300,000원", (i) =>
    i < ds.length
      ? `<hp:t>1회 X ${blockHours[i]}시간 X ${unit.toLocaleString()}원 = ${blockAmts[i].toLocaleString()}원</hp:t>`
      : `<hp:t></hp:t>`);
  // 강사료(청구액) 칸 "300,000" (블록별) — 금액으로 교체, 남으면 비움
  let pi = 0;
  xml = xml.replace(/<hp:t>300,000<\/hp:t>/g, () =>
    pi < ds.length ? `<hp:t>${blockAmts[pi++].toLocaleString()}</hp:t>` : (pi++, `<hp:t></hp:t>`));
  // 학교/역할/프로그램명(강의내용 칸): "한솔초"·"주강사"
  if (data.school) xml = replaceInRun(xml, "한솔초", () => ` ${data.school} `);
  if (data.role) xml = xml.replace(/<hp:t>주강사<\/hp:t>/g, `<hp:t>${xmlEsc(data.role)}</hp:t>`);
  // 총 지급 신청액 "1,200,000 원"(' 원'까지 한 run) → 부분치환
  const grand = blockAmts.reduce((a, b) => a + b, 0);
  xml = replaceInRun(xml, "1,200,000", (t) => t.replace(/1,200,000/, grand.toLocaleString()));
  // 신청자 성명 "권준구"(2곳: 개인정보 성명 + 신청자)
  if (data.name) xml = replaceText(xml, "권준구", data.name);
  // 신청일자 "2026\n년    6월  28일" → 마지막일. run 분리되어 있어 월/일만 치환
  if (ds.length) {
    const l = ds[ds.length - 1].date;
    xml = replaceInRun(xml, "년    6월  28일", () => `년    ${l.m}월  ${l.d}일`);
  }
  xml = fillCommonHead(xml, data);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 6) 업무보고서 (안전관리자) =====
// 안전: 20,000원/시간(회), 4회를 1블록에 합산. 한도 표기 유지.
// data: { program, school, name, days, totalAmount, lastDate }
export async function buildGachonWorkHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const ds = (data.days || []).filter(d => d && d.date);

  // 활용실적 1블록: 일자 2줄(오전/오후 범위), 횟수(4회), 청구액(240,000), 산출(4회 X 4시간 X 20,000원 = 240,000원)
  if (ds.length) {
    const f = ds[0].date, l = ds[ds.length - 1].date;
    // 일자 범위 "2026-06-28 09:00 ~ 06-29 12:10" (오전), 오후줄 "2026-06-28 13:00 ~ 06-29 16:10"
    xml = replaceInRun(xml, "2026-06-28 09:00 ~ 06-29 12:10",
      () => `2026-${pad2(f.m)}-${pad2(f.d)} ${fmtTime(ds[0].start)} ~ ${pad2(l.m)}-${pad2(l.d)} ${fmtTime(ds[ds.length-1].end)}`);
  }
  // 산출내역 — app에서 계산한 calcLine로 통째 교체 (예: "8회 X 20,000원 = 160,000원 (1일 한도 60,000원)")
  if (data.calcLine) xml = replaceInRun(xml, "4회 X 4시간 X 20,000원 = 240,000원", () => data.calcLine);
  // 금액 — 총 청구액/총 지급신청액 "240,000"(청구액 칸, 총액 칸 2곳)
  if (data.totalAmount) {
    xml = replaceInRun(xml, "240,000원", (t) => t.replace(/240,000/, data.totalAmount));
    xml = xml.replace(/<hp:t>240,000<\/hp:t>/g, `<hp:t>${xmlEsc(data.totalAmount)}</hp:t>`);
  }
  // 횟수 "4회"(청구 횟수 칸) → 실제 회차 수
  if (data.rounds) xml = xml.replace(/<hp:t>4회<\/hp:t>/g, `<hp:t>${xmlEsc(String(data.rounds))}회</hp:t>`);
  if (data.school) xml = replaceInRun(xml, "한솔초", () => ` ${data.school} `);
  if (data.name) xml = replaceText(xml, "권준구", data.name);
  if (ds.length) {
    const l = ds[ds.length - 1].date;
    xml = replaceInRun(xml, "년    월    일", () => `년  ${l.m}  월  ${l.d}  일`);
  }
  xml = fillCommonHead(xml, data);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 7) 배너 pptx (학교명/일시 치환) =====
// data: { school, dateText }  — slide1.xml의 "학교명기입"/"일시기입" 치환
export async function buildGachonBanner(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const slidePath = "ppt/slides/slide1.xml";
  let xml = await zip.file(slidePath).async("string");
  if (data.school) xml = xml.replace(/<a:t>학교명기입<\/a:t>/g, `<a:t>${xmlEsc(data.school)}</a:t>`);
  if (data.dateText) xml = xml.replace(/<a:t>일시기입<\/a:t>/g, `<a:t>${xmlEsc(data.dateText)}</a:t>`);
  zip.file(slidePath, xml);
  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  });
}
