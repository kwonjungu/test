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
// {m,d}에서 delta일 이동(월 경계 자동 처리). 연도 2026 고정.
function shiftDate(o, delta) {
  const dt = new Date(2026, o.m - 1, o.d + delta);
  return { m: dt.getMonth() + 1, d: dt.getDate() };
}
// "09:00" → "09시00분"
function hmKor(s) { return fmtTime(s).replace(":", "시") + "분"; }

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

// 텍스트 노드 안의 글자를 모두 바꾼다(한 run 안에 탭·여러 칸 공백이 섞여 있어도 됨).
// 예: "신청자 :   권준구      (인)<hp:tab/>" 처럼 정확매칭이 안 되는 자리. oldText는 태그 이름·속성에 없는 글자여야 한다.
function replaceAllText(xml, oldText, newText) {
  if (!oldText || newText == null) return xml;
  return xml.split(oldText).join(xmlEsc(newText));
}

// section 최상위 문단(<hp:p>…</hp:p>)의 [시작, 끝] 목록 (표 안 문단은 포함하지 않음)
function topParas(xml) {
  const base = xml.indexOf(">", xml.indexOf("<hs:sec")) + 1;
  const re = /<hp:p\b[^>]*>|<\/hp:p>/g;
  re.lastIndex = base;
  const out = [];
  let depth = 0, start = -1, m;
  while ((m = re.exec(xml))) {
    if (m[0] === "</hp:p>") {
      depth--;
      if (depth === 0) out.push([start, m.index + m[0].length]);
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}
const plainText = (seg) => (seg.match(/<hp:t>[^<]*<\/hp:t>/g) || []).map(t => t.slice(6, -7)).join("");

// marker 글자가 든 표에서 (col,row) 칸의 빈 run에 글자를 넣는다. 칸에 글자가 이미 있으면 그대로 둔다.
function setEmptyCell(xml, marker, col, row, text) {
  if (!text) return xml;
  const mi = xml.indexOf(marker);
  if (mi < 0) return xml;
  const ts = xml.lastIndexOf("<hp:tbl", mi), te = xml.indexOf("</hp:tbl>", mi);
  if (ts < 0 || te < 0) return xml;
  let tbl = xml.slice(ts, te);
  tbl = tbl.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    if (!tc.includes(`<hp:cellAddr colAddr="${col}" rowAddr="${row}"/>`)) return tc;
    return tc.replace(/<hp:run charPrIDRef="(\d+)"\/>/, (mm, cid) => `<hp:run charPrIDRef="${cid}"><hp:t>${xmlEsc(text)}</hp:t></hp:run>`);
  });
  return xml.slice(0, ts) + tbl + xml.slice(te);
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
  // 치환 후 남은 줄 레이아웃 캐시(linesegarray)가 본문과 어긋나면 한글이
  // "손상/변조 가능성" 문서로 판정(보안설정 낮음에서만 열림) → 전부 제거(한글이 재계산).
  for (const k of Object.keys(zip.files)) {
    if (/^Contents\/section\d+\.xml$/.test(k)) {
      let sec = await zip.file(k).async("string");
      sec = sec.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>|<hp:linesegarray\s*\/>/g, "");
      zip.file(k, sec);
    }
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
    // 수령대장류: 값칸 글자모양이 달라(charPr 18 등) 위 규칙에 안 걸림 → 표 2열(colAddr=1) 셀의 "프로그램명" 값도 채움
    xml = xml.replace(/(<hp:run charPrIDRef="\d+"><hp:t>)프로그램명(<\/hp:t><\/hp:run>(?:<hp:linesegarray>(?:(?!<\/hp:linesegarray>)[\s\S])*<\/hp:linesegarray>)?<\/hp:p><\/hp:subList><hp:cellAddr colAddr="1")/g,
      (m, a, b) => `${a}${xmlEsc(data.program)}${b}`);
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
  // 같은 run에 붙은 시간(결과보고서 ", 09:00~12:10", 교구지급 " 09:00~12:10")도 이 반의 실제 시간으로(오후반 대비)
  // 식다과 3일·4일 템플릿의 "~ 06월 22일"/"~ 06월 23일"도 같은 규칙으로 맞춘 뒤 치환
  xml = xml.replace(/(<hp:t>[^<]*2026년 06월 20일 ~ 06월 )2[2-9](일)/g, (m, a, b) => `${a}21${b}`);
  xml = replaceInRun(xml, "2026년 06월 20일 ~ 06월 21일",
    (t) => t.replace(/2026년 06월 20일 ~ 06월 21일/, `2026년 ${pad2(f.date.m)}월 ${pad2(f.date.d)}일 ~ ${pad2(l.date.m)}월 ${pad2(l.date.d)}일`)
            .replace(/\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2}/, t0));
  // 수령일시 "2026년 6월 20일 09:00~12:10" → 시작일+시간
  xml = replaceInRun(xml, "2026년 6월 20일 09:00",
    () => `2026년 ${f.date.m}월 ${f.date.d}일 ${t0} `);
  // 식다과: 회차별 지급일 "(N회 지급일) 6월 2X일 09:00~12:10" (2일·3일·4일 템플릿) → 날짜마다 채우고, 날짜가 모자라면 회차 표시만 남김
  for (let n = 1; n <= 4; n++) {
    const s = ds[n - 1];
    xml = replaceInRun(xml, `(${n}회 지급일)`, () => s
      ? `(${n}회 지급일) ${s.date.m}월 ${s.date.d}일 ${fmtTime(s.start)}~${fmtTime(s.end)} `
      : `(${n}회 지급일) `);
  }
  // 교구지급 제출일 "2026. 06. 21." (마지막일)
  xml = replaceText(xml, `2026. ${pad2(6)}. ${pad2(21)}.`, `2026. ${pad2(l.date.m)}. ${pad2(l.date.d)}.`);
  return xml;
}

// 학생 명단 표("홍길동" 칸이 든 표)의 학생 행을 n개 이상으로 맞춘다.
// 학생이 템플릿 행보다 많으면 마지막 학생 행을 복제해 붙이고(NO 이어 매김), 학생 행부터 표 끝까지의 행 높이를
// 원래 합계 안에서 고르게 줄여 한 쪽에 들어가게 한다. 행 높이는 minH(약 4.8mm, 10pt 한 줄이 들어가는 높이) 아래로 내리지 않는다. 그보다 학생이 많으면(2일 약 32명, 3·4일 약 29명 넘게) 표가 길어져 다음 쪽으로 넘어간다(글자처럼 취급 표라 표 전체가 넘어감).
function ensureStudentRows(xml, n, minH = 1350) {
  const mi = xml.indexOf("<hp:t>홍길동</hp:t>");
  if (mi < 0) return xml;
  const ts = xml.lastIndexOf("<hp:tbl", mi), te = xml.indexOf("</hp:tbl>", mi);
  if (ts < 0 || te < 0) return xml;
  const tbl = xml.slice(ts, te);
  const trs = [...tbl.matchAll(/<hp:tr>[\s\S]*?<\/hp:tr>/g)];
  if (!trs.length) return xml;
  let rows = trs.map(m => m[0]);
  const prefix = tbl.slice(0, trs[0].index);
  const suffix = tbl.slice(trs[trs.length - 1].index + trs[trs.length - 1][0].length);
  const isStu = (tr) => (tr.match(/<hp:tc\b[\s\S]*?<\/hp:tc>/g) || [])
    .some(tc => /colAddr="1"/.test(tc) && /<hp:t>홍길동<\/hp:t>/.test(tc));
  const stu = rows.map((tr, i) => isStu(tr) ? i : -1).filter(i => i >= 0);
  if (!stu.length || n <= stu.length) return xml;
  const first = stu[0], last = stu[stu.length - 1];
  const rowH = (tr) => +((tr.match(/<hp:cellSz width="\d+" height="(\d+)"\/>/) || [0, 0])[1]);
  const oldTotal = rows.slice(first).reduce((acc, tr) => acc + rowH(tr), 0);
  const clones = [];
  for (let k = stu.length; k < n; k++) {
    // 첫 칸(NO)의 숫자만 바꾼다
    clones.push(rows[last].replace(/(<hp:tc\b[\s\S]*?<hp:t>)\d+(<\/hp:t>)/, (m, p1, p2) => p1 + (k + 1) + p2));
  }
  rows = rows.slice(0, last + 1).concat(clones, rows.slice(last + 1));
  const cnt = rows.length - first;
  const h = Math.max(minH, Math.floor(oldTotal / cnt));
  rows = rows.map((tr, i) => {
    tr = tr.replace(/rowAddr="\d+"/g, `rowAddr="${i}"`);
    if (i >= first) tr = tr.replace(/(<hp:cellSz width="\d+" height=")\d+(")/g, (m, p1, p2) => p1 + h + p2);
    return tr;
  });
  const newTotal = h * cnt;
  const head = prefix.replace(/rowCnt="\d+"/, `rowCnt="${rows.length}"`)
    .replace(/(<hp:sz width="\d+" widthRelTo="\w+" height=")(\d+)(")/, (m, p1, hh, p3) => `${p1}${+hh - oldTotal + newTotal}${p3}`);
  return xml.slice(0, ts) + head + rows.join("") + suffix + xml.slice(te);
}

// 학생 실명 주입: 명단 표의 성명 칸(colAddr="1") "홍길동"을 위에서부터 차례로 교체, 남는 칸은 비움.
// 학생이 템플릿 행(식다과 2일·교재교구 23행, 3일·4일 21행)보다 많으면 먼저 행을 늘린다(이름이 잘리지 않게).
function fillReceiptNames(xml, names) {
  xml = ensureStudentRows(xml, names.length);
  let idx = 0;
  return xml.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    if (!/colAddr="1" rowAddr="\d+"/.test(tc)) return tc;
    if (!/<hp:t>홍길동<\/hp:t>/.test(tc)) return tc;
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
// header의 paraPr를 왼쪽정렬로 복제(추진의견 칸 왼쪽정렬용). 새 id 반환.
function makeLeftParaCloner(header) {
  const cache = {};
  return function leftPara(srcId) {
    if (cache[srcId] != null) return cache[srcId];
    const m = header.xml.match(new RegExp(`<hh:paraPr id="${srcId}"[\\s\\S]*?</hh:paraPr>`));
    if (!m) return srcId;
    const ids = [...header.xml.matchAll(/<hh:paraPr id="(\d+)"/g)].map(x => +x[1]);
    const newId = (ids.length ? Math.max(...ids) : 0) + 1;
    let clone = m[0].replace(`id="${srcId}"`, `id="${newId}"`);
    clone = /<hh:align\b[^>]*\/>/.test(clone)
      ? clone.replace(/<hh:align\b[^>]*\/>/, '<hh:align horizontal="LEFT" vertical="BASELINE"/>')
      : clone.replace(/(<hh:paraPr id="\d+"[^>]*>)/, '$1<hh:align horizontal="LEFT" vertical="BASELINE"/>');
    header.xml = header.xml.replace(m[0], m[0] + clone)
      .replace(/(<hh:paraProperties itemCnt=")(\d+)(")/, (mm, a, n, b) => a + (+n + 1) + b);
    cache[srcId] = newId;
    return newId;
  };
}

// 추진의견 주입: 라벨 다음 빈 작성칸 run에 본문 삽입 + 그 단락을 왼쪽정렬·자동줄바꿈 처리
function fillGachonOpinions(xml, header, leftPara, opinions) {
  const ops = opinions || {};
  const labels = { "주강사": "(주강사 작성용)", "보조강사": "(보조강사 작성용)", "안전관리자": "(안전관리자 작성용)" };
  for (const role of Object.keys(labels)) {
    const text = (ops[role] || "").trim();
    if (!text) continue;
    const li = xml.indexOf(labels[role]);
    if (li < 0) continue;
    // 라벨 이후 첫 빈 run(자체닫힘 또는 빈 텍스트)
    const relM = xml.slice(li).match(/<hp:run charPrIDRef="(\d+)"\/>|<hp:run charPrIDRef="(\d+)"><hp:t><\/hp:t><\/hp:run>/);
    if (!relM) continue;
    const runStr = relM[0];
    const cid = relM[1] || relM[2];
    const pos = li + xml.slice(li).indexOf(runStr);
    // 빈 run을 감싸는 <hp:p> 경계
    const pStart = xml.lastIndexOf("<hp:p ", pos);
    const pEndIdx = xml.indexOf("</hp:p>", pos);
    if (pStart < 0 || pEndIdx < 0) continue;
    const pEnd = pEndIdx + 7;
    let para = xml.slice(pStart, pEnd);
    const pp = para.match(/paraPrIDRef="(\d+)"/);
    if (pp) para = para.replace(/paraPrIDRef="\d+"/, `paraPrIDRef="${leftPara(pp[1])}"`);  // 왼쪽정렬
    para = para.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/, "");                 // 고정 줄정보 제거 → 자동 줄바꿈
    para = para.replace(runStr, `<hp:run charPrIDRef="${cid}"><hp:t>${xmlEsc(text)}</hp:t></hp:run>`);
    xml = xml.slice(0, pStart) + para + xml.slice(pEnd);
  }
  return xml;
}
export async function buildGachonReportHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const secPath = "Contents/section0.xml", hdrPath = "Contents/header.xml";
  let xml = await zip.file(secPath).async("string");
  const header = { xml: await zip.file(hdrPath).async("string") };
  const leftPara = makeLeftParaCloner(header);
  xml = fillCommonHead(xml, data);
  xml = fillDates(xml, data.days);
  if (data.opinions) xml = fillGachonOpinions(xml, header, leftPara, data.opinions);
  zip.file(secPath, xml);
  zip.file(hdrPath, header.xml);
  return packageHwpx(zip);
}

// ===== 5) 강의보고서 (주/보조강사) =====
// 실적 블록: 강의일자/횟수(1회)/강사료/산출내역(1회 X N시간 X 단가). 일자(반×일) 수만큼 블록을 만든다(1~4개 이상).
// data: { program, school, name, affiliation, role:"주강사"|"보조강사", days }
const LECTURE_UNIT = { "주강사": 75000, "보조강사": 45000 };

// 프로그램명 표시용: "(초저) " 등 앞 괄호 접두를 뗀 이름
function progDisplay(p) { return (p || "").replace(/^\([^)]*\)\s*/, "").trim(); }

// 강의내용 4번(업무 내용) — 양식에 박힌 기본 문구 대신 프로그램별 한 줄(원문과 비슷한 길이)
const ACTIVITY_BY_PROGRAM = [
  { key: /마음건강|휴로/, line: "체험형 AI 감정 표현과 휴머노이드 로봇 교감 코딩 커리큘럼" },
  { key: /코드블루|골든타임/, line: "응급 상황 분류와 구급 로봇 코딩으로 컴퓨팅 사고력을 기르는 커리큘럼" },
  { key: /간식|레벨업|데이터로/, line: "간식 영양성분 데이터 수집·분석으로 데이터 소양을 기르는 커리큘럼" },
  { key: /주니어|메디\s*로봇\s*출시/, line: "AI 메디 로봇 기획·제작과 창업 체험 프로젝트 커리큘럼" },
  { key: /메디컬\s*DX/, line: "의료 AI·로보틱스 실습으로 인공지능 소양을 기르는 커리큘럼" },
  { key: /해커톤|디자인\s*씽킹|디자인씽킹/, line: "디자인씽킹 기반 AI 메디컬 해커톤 프로젝트 커리큘럼" },
  { key: /다가치|多|국경/, line: "디지털 콘텐츠 제작으로 의료·보건 문제를 해결하는 포용형 커리큘럼" }
];
function activityLine(program, role) {
  const hit = ACTIVITY_BY_PROGRAM.find(a => a.key.test(program || ""));
  const base = hit ? hit.line : "아이들의 컴퓨팅 사고력 향상을 위한 커리큘럼";
  return role === "보조강사"
    ? `프로그램 운영 보조강사, ${base} 진행 보조 및 학생 지도`
    : `프로그램 운영 주강사, ${base} 운영`;
}
export async function buildGachonLectureHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const unit = LECTURE_UNIT[data.role] || 75000;
  const ds = (data.days || []).filter(d => d && d.date);

  const fmtDate = (d) => `2026-${pad2(d.date.m)}-${pad2(d.date.d)} ${fmtTime(d.start)} ~ ${pad2(d.date.m)}-${pad2(d.date.d)} ${fmtTime(d.end)}`;
  // 일자별 차시(시간) — days[i].chasi 우선, 없으면 시계시간 반올림(최소 1)
  const blockHours = ds.map(d => d.chasi || Math.round(hoursBetween(d.start, d.end)) || 4);
  const blockAmts = blockHours.map(h => h * unit);   // 시간당 단가 × 차시
  const progNm = progDisplay(data.program);

  // "강사 활용 실적" 블록(제목 문단 + 표 문단)을 운영 일수(블록 수)만큼만 둔다.
  // 템플릿엔 4블록이 [제목, 표, 빈 문단] 순서로 있다 → 1블록을 원본으로 n개를 새로 만들어 4블록 자리를 통째로 바꾼다.
  const ps = topParas(xml);
  const heads = ps.map((p, i) => i).filter(i => {
    const seg = xml.slice(ps[i][0], ps[i][1]);
    return !seg.includes("<hp:tbl") && plainText(seg).includes("강사 활용 실적");
  });
  if (heads.length) {
    const h1 = heads[0], hl = heads[heads.length - 1];
    const headP = xml.slice(ps[h1][0], ps[h1][1]);
    const tblP = xml.slice(ps[h1 + 1][0], ps[h1 + 1][1]);
    const spacer = heads.length > 1 ? xml.slice(ps[h1 + 2][0], ps[h1 + 2][1]) : "";
    const n = Math.max(1, ds.length);
    const blocks = [];
    for (let i = 0; i < n; i++) {
      const has = i < ds.length;
      let hp = headP.replace(/강사 활용 실적\s*[-–]\s*\d+\s*/, `강사 활용 실적 - ${i + 1}`);
      let t = tblP;
      t = replaceText(t, "2026-06-28 09:00 ~ 06-28 12:10", has ? fmtDate(ds[i]) : "");
      t = replaceText(t, "1회 X 4시간 X 75,000원 = 300,000원",
        has ? `1회 X ${blockHours[i]}시간 X ${unit.toLocaleString()}원 = ${blockAmts[i].toLocaleString()}원` : "");
      t = replaceText(t, "300,000", has ? blockAmts[i].toLocaleString() : "");
      if (!has) t = replaceText(t, "1회", "");
      if (data.school) t = replaceInRun(t, "한솔초", () => ` ${data.school} `);
      if (data.role) t = replaceText(t, "2. 역할 : 주강사", `2. 역할 : ${data.role}`);
      if (progNm) t = replaceText(t, "알고리즘 타고 건강으로 GO!", progNm);
      t = replaceText(t, "프로그램 운영 주강사, 아이들의 컴퓨팅 사고력 향상을 위한 커리큘럼 운영",
        activityLine(data.program, data.role));
      blocks.push(hp + t);
    }
    xml = xml.slice(0, ps[h1][0]) + blocks.join(spacer) + xml.slice(ps[hl + 1][1]);
  }
  // 총 지급 신청액 "1,200,000 원"(' 원'까지 한 run) → 부분치환
  const grand = blockAmts.reduce((a, b) => a + b, 0);
  xml = replaceInRun(xml, "1,200,000", (t) => t.replace(/1,200,000/, grand ? grand.toLocaleString() : ""));
  // 성명 "권준구"(강사 정보 성명 칸 + 신청자 줄). 신청자 줄은 공백·탭과 한 run이라 글자 단위로 바꾼다.
  xml = replaceAllText(xml, "권준구", data.name || "");
  // 강사 정보: 소속(사람마다 입력받은 값), 직급은 사이트가 모르는 값이라 비움
  xml = setEmptyCell(xml, "은행/계좌번호", 3, 4, data.affiliation || "");
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
// 안전: 20,000원/시간(회), 활용실적 1블록에 합산. 한도 표기 유지. 끝에 개인정보 활용 동의서·첨부서류 쪽(최신 양식).
// data: { program, school, name, affiliation, days, totalAmount, rounds, calcLine }
export async function buildGachonWorkHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const ds = (data.days || []).filter(d => d && d.date);

  // 일자 칸: 템플릿엔 지난 기수 일자 문단 2개("2026-06-28 09:00 ~ 06-29 12:10", "2026-06-28 13:00 ~ 06-29 16:10").
  // 첫 문단을 원본으로 운영 일수만큼 한 줄씩 만들고 나머지 문단은 지운다.
  const ci = xml.indexOf("2026-06-28 09:00 ~ 06-29 12:10");
  if (ci >= 0) {
    const ss = xml.lastIndexOf("<hp:subList", ci), se = xml.indexOf("</hp:subList>", ci);
    const inner0 = xml.indexOf(">", ss) + 1;
    const cell = xml.slice(inner0, se);
    const firstP = (cell.match(/<hp:p\b[\s\S]*?<\/hp:p>/) || [""])[0];
    const lines = ds.length
      ? ds.map(d => `2026-${pad2(d.date.m)}-${pad2(d.date.d)} ${fmtTime(d.start)} ~ ${pad2(d.date.m)}-${pad2(d.date.d)} ${fmtTime(d.end)}`)
      : [""];
    const newCell = lines.map(s => replaceText(firstP, "2026-06-28 09:00 ~ 06-29 12:10", s)).join("");
    xml = xml.slice(0, inner0) + newCell + xml.slice(se);
  }
  // 산출내역 — app에서 계산한 calcLine로 통째 교체 (예: "20,000원 X 6시간 (반별 1일 한도 60,000원 적용) = 120,000원")
  if (data.calcLine) xml = replaceInRun(xml, "4회 X 4시간 X 20,000원 = 240,000원", () => data.calcLine);
  // 금액 — 청구액 칸 " 240,000원", 총액 칸 "240,000원"
  if (data.totalAmount) {
    xml = replaceInRun(xml, "240,000원", (t) => t.replace(/240,000/, data.totalAmount));
    xml = xml.replace(/<hp:t>240,000<\/hp:t>/g, `<hp:t>${xmlEsc(data.totalAmount)}</hp:t>`);
  }
  // 횟수 "4회"(청구 횟수 칸) → 실제 회차 수
  if (data.rounds) xml = xml.replace(/<hp:t>4회<\/hp:t>/g, `<hp:t>${xmlEsc(String(data.rounds))}회</hp:t>`);
  if (data.school) xml = replaceInRun(xml, "한솔초", () => ` ${data.school} `);
  // 성명 "권준구"(개인 정보 성명 칸 + "신청자 :            권준구  (인)" 줄) — 공백 폭과 상관없이 글자 단위로
  xml = replaceAllText(xml, "권준구", data.name || "");
  xml = setEmptyCell(xml, "은행/계좌번호", 3, 4, data.affiliation || "");
  // 내용 칸의 박힌 값 교체: 프로그램명(양식 기본 "알고리즘 타고 건강으로 GO!")
  const progNm = progDisplay(data.program);
  if (progNm) xml = replaceText(xml, "알고리즘 타고 건강으로 GO!", progNm);
  xml = replaceText(xml, "2. 역할 : 전관리자", "2. 역할 : 안전관리자");   // 옛 템플릿 대비
  if (ds.length) {
    const l = ds[ds.length - 1].date;
    xml = replaceInRun(xml, "년    월    일", () => `년  ${l.m}  월  ${l.d}  일`);
  }
  xml = fillCommonHead(xml, data);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 3-2) 안전관리 서약서 =====
// 자리표시자: "프로그램명을 작성해주세요", "2026년"+" 00월 00일 ~ 00월 00일 / 학교 및 기관명"(한 run),
//             서약일 "2026. 00. 00." (시작일 전 2일). 표의 현장안전담당 성명 칸 = data.name(안전관리자),
//             서명란은 자필 서명이라 비움.
// data: { program, school, days, name }
export async function buildGachonSafetyPledgeHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const ds = (data.days || []).filter(d => d && d.date);
  if (data.program) xml = replaceInRun(xml, "프로그램명을 작성해주세요", (t) => t.replace("프로그램명을 작성해주세요", data.program));
  if (ds.length) {
    const f = ds[0].date, l = ds[ds.length - 1].date;
    xml = replaceInRun(xml, "00월 00일 ~ 00월 00일 / 학교 및 기관명",
      (t) => t.replace("00월 00일 ~ 00월 00일 / 학교 및 기관명",
        `${pad2(f.m)}월 ${pad2(f.d)}일 ~ ${pad2(l.m)}월 ${pad2(l.d)}일 / ${data.school || "학교 및 기관명"}`));
    const chk = shiftDate(f, -2);   // 서약일 = 시작일 - 2일
    xml = replaceInRun(xml, "2026. 00. 00.", (t) => t.replace("2026. 00. 00.", `2026. ${pad2(chk.m)}. ${pad2(chk.d)}.`));
  } else if (data.school) {
    xml = replaceInRun(xml, "학교 및 기관명", (t) => t.replace("학교 및 기관명", data.school));
  }
  // 현장안전담당 줄: 성명 칸 "안전관리자 작성"(첫째) → 안전관리자 이름, 연락처 칸 "안전관리자 작성"(둘째) → 빈칸
  let k = 0;
  xml = xml.replace(/<hp:t>안전관리자 작성<\/hp:t>/g, () => (k++ === 0)
    ? `<hp:t>${xmlEsc(data.name || "")}</hp:t>` : "<hp:t></hp:t>");
  // 양식 안내문 "※ 현장안전담당이 2명 이상일 경우 … (제출 시 해당 문구는 삭제)" 지움(문단 자리는 남김)
  xml = xml.replace(/<hp:t>※ 현장안전담당이 2명 이상일 경우[^<]*(?:<hp:lineBreak\/>[^<]*)*<\/hp:t>/g, "<hp:t></hp:t>");
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 3-3) 안전 결과보고서 =====
// 자리표시자: "프로그램명 작성해주세요", "2026년 00월 00일 ~ 00월 00일", "00시00분 ~ 00시 00분",
//             운영기관 "00기관명 or 00학교명". (본문에 이름/클래스 칸 없음 — 파일명에만 표기)
// data: { program, school, days }
export async function buildGachonSafetyReportHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const ds = (data.days || []).filter(d => d && d.date);
  if (data.program) xml = replaceInRun(xml, "프로그램명 작성해주세요", (t) => t.replace("프로그램명 작성해주세요", data.program));
  if (ds.length) {
    const f = ds[0], l = ds[ds.length - 1];
    xml = replaceInRun(xml, "2026년 00월 00일 ~ 00월 00일",
      (t) => t.replace("2026년 00월 00일 ~ 00월 00일",
        `2026년 ${pad2(f.date.m)}월 ${pad2(f.date.d)}일 ~ ${pad2(l.date.m)}월 ${pad2(l.date.d)}일`));
    xml = replaceInRun(xml, "00시00분 ~ 00시 00분",
      (t) => t.replace("00시00분 ~ 00시 00분", `${hmKor(f.start)} ~ ${hmKor(f.end)}`));
  }
  if (data.school) xml = replaceInRun(xml, "00기관명 or 00학교명", (t) => t.replace("00기관명 or 00학교명", data.school));
  zip.file(path, xml);
  return packageHwpx(zip);
}

// ===== 3-4) 운영 전·후 안전관리 체크리스트 =====
// 점검일자(운영 전 4곳)=시작일-2일, 운영 후 점검일=종료일. 점검책임자/점검자=안전관리자 성명.
// data: { name, days }
export async function buildGachonChecklistHwpx(templateBuf, data) {
  const { zip, path } = await loadSection(templateBuf);
  let xml = await zip.file(path).async("string");
  const ds = (data.days || []).filter(d => d && d.date);
  if (ds.length) {
    const f = ds[0].date, l = ds[ds.length - 1].date, chk = shiftDate(f, -2);
    // 점검일자 자리표시자("2026년  월  일")는 운영 전 4곳 + 운영 후 1곳. 문서 순서상 마지막이 운영 후.
    // 마지막 = 종료일, 나머지(운영 전) = 시작일 - 2일. (라벨이 별도 run이라 위치로 구분)
    const re = /2026년\s+월\s+일/g;
    const total = (xml.match(re) || []).length;
    let idx = 0;
    xml = xml.replace(re, () => {
      idx++;
      return (idx === total)
        ? `2026년 ${l.m}월 ${l.d}일`        // 운영 후 점검일 = 종료일
        : `2026년 ${chk.m}월 ${chk.d}일`;   // 운영 전 점검일자 = 시작일 - 2일
    });
  }
  if (data.name) {
    xml = xml.replace(/점검책임자 :\s+/g, `점검책임자 : ${xmlEsc(data.name)}  `);   // 운영 전
    xml = xml.replace(/점검자\s*\(인\)/g, `점검자 ${xmlEsc(data.name)} (인)`);        // 운영 후(한 run일 때)
    // 운영 후 "점검자"·공백·"(인)"이 run으로 나뉜 양식: 점검자 뒤 공백 run에 이름을 넣는다
    xml = xml.replace(/(점검자<\/hp:t><\/hp:run>(?:<hp:run charPrIDRef="\d+"><hp:t> <\/hp:t><\/hp:run>)?<hp:run charPrIDRef="\d+"><hp:t>)\s{2,}(<\/hp:t>)/,
      (m, a, b) => `${a}  ${xmlEsc(data.name)}  ${b}`);
  }
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
