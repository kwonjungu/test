// 캠프명단 파싱 + 변환 + 등록양식 xlsx 생성
// 의존: 전역 XLSX(SheetJS), JSZip

// ---------- 변환 규칙 ----------
export function anonymizeName(name) {
  const s = (name || "").toString().trim();
  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + "0";
  return s[0] + "0" + s[s.length - 1];   // 가운데 전부 단일 0
}

// 연락처는 익명화용 고정 더미값으로 통일
export const DUMMY_PHONE = "010-1234-1234";
export function formatPhone(_raw) {
  return DUMMY_PHONE;
}

// 임의 이메일 자동생성 (익명용)
const EMAIL_DOMAINS = ["naver.com", "gmail.com", "daum.net", "hanmail.net", "kakao.com"];
export function randomEmail() {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const len = 5 + Math.floor(Math.random() * 4);   // 5~8자
  let local = "";
  for (let i = 0; i < len; i++) local += chars[Math.floor(Math.random() * chars.length)];
  local += Math.floor(Math.random() * 1000);        // 숫자 접미
  const domain = EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
  return `${local}@${domain}`;
}

export function schoolLevel(schoolName, courseLevel) {
  const s = (schoolName || "").toString();
  if (s.includes("초등학교")) return "초등학교";
  if (s.includes("중학교")) return "중학교";
  if (s.includes("고등학교")) return "고등학교";
  // 프로그램 학교급 폴백: 초저/초고/중등/고등
  const c = (courseLevel || "").toString();
  if (c.includes("초")) return "초등학교";
  if (c.includes("중")) return "중학교";
  if (c.includes("고")) return "고등학교";
  return "초등학교";
}

export function gradeText(gradeNum, level) {
  const n = parseInt((gradeNum || "").toString().replace(/\D/g, ""), 10);
  if (!n) return "";
  return `${level} ${n}학년`;
}

export function randomClass() {
  return String(Math.floor(Math.random() * 4) + 1);  // 1~4
}

// 프로그램명에서 학교급 추출: "(기본/초저) ..." -> "초저"
function courseLevelFromProgram(prog) {
  const m = (prog || "").toString().match(/\(([^/]+)\/([^)]+)\)/);
  return m ? m[2].trim() : "";
}

// 프로그램명에서 과정 추출: "(기본/초저) ..." -> "기본"
function courseTypeFromProgram(prog) {
  const m = (prog || "").toString().match(/\(([^/]+)\/([^)]+)\)/);
  return m ? m[1].trim() : "";
}

// 과정 -> 총차시 기본값: 기본=8, 그 외(특화/AI특화)=12
export function defaultChasi(courseType) {
  return /기본/.test(courseType || "") ? 8 : 12;
}

// "2026.06.20." -> {m:6, d:20}
export function parseYmd(s) {
  const m = (s || "").toString().match(/(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

// 시작~종료 날짜를 일자 배열로: [{m,d}, ...]
export function dateRange(start, end) {
  const a = parseYmd(start), b = parseYmd(end);
  if (!a) return [];
  if (!b) return [{ m: a.m, d: a.d }];
  const out = [];
  let cur = new Date(a.y, a.m - 1, a.d);
  const last = new Date(b.y, b.m - 1, b.d);
  let guard = 0;
  while (cur <= last && guard++ < 40) {
    out.push({ m: cur.getMonth() + 1, d: cur.getDate() });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// {m,d} -> "6월 20일"
export function fmtDate(o) {
  return o ? `${o.m}월 ${o.d}일` : "";
}

// 원DB '일시' 문자열 → [{date:{m,d}, start:"HH:MM", end:"HH:MM"}]
// ampm: "am"(오전반) | "pm"(오후반) — 시간 슬롯이 2개면 오후반은 두 번째 사용
export function parseSchedule(ilsi, ampm = "am") {
  const s = (ilsi || "").toString();
  if (!s) return [];
  // 날짜 토큰: "M월 D일" 우선, 없으면 "M.D"
  let dates = [];
  let m;
  const re1 = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
  while ((m = re1.exec(s))) dates.push({ m: +m[1], d: +m[2] });
  if (!dates.length) {
    const re2 = /(\d{1,2})\.(\d{1,2})/g;
    while ((m = re2.exec(s))) dates.push({ m: +m[1], d: +m[2] });
  }
  // 중복 제거 + 정렬
  const seen = new Set(), uniq = [];
  for (const d of dates) { const k = d.m * 100 + d.d; if (!seen.has(k)) { seen.add(k); uniq.push(d); } }
  uniq.sort((a, b) => a.m - b.m || a.d - b.d);
  // 시간 슬롯
  const times = [...s.matchAll(/(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/g)].map(x => [x[1], x[2]]);
  const slot = (ampm === "pm" && times.length >= 2) ? times[1] : (times[0] || ["", ""]);
  const fix = t => t ? t.replace(/^(\d):/, "0$1:") : "";   // "9:00" -> "09:00"
  return uniq.map(d => ({ date: d, start: fix(slot[0]), end: fix(slot[1]) }));
}

// 프로그램명 핵심부 (모든 괄호(과정/급·차시·(多) 등)·공백 제거 — finder와 동일 규칙)
export function programCore(p) {
  return (p || "").toString()
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "");
}

// 사회적배려자 학급 여부 (다문화 과정)
export function isSocialClass(program, courseLevel) {
  return /다문화/.test((courseLevel || "") + " " + (program || ""));
}

// 일반학생 여부 값 결정
// - 사회적배려자(다문화) 학급에서만 기입: 배려대상(다문화 등) 아니면 일반학생 → "Y"
// - 그 외 학급은 공란
export function generalStudentFlag(memo, social) {
  if (!social) return "";
  const m = (memo || "").toString();
  const cared = /다문화|사회적\s*배려|저소득|한부모|탈북|새터민|특수|장애/.test(m);
  return cared ? "" : "Y";
}

// 라벨 셀(index) 이후 첫 비어있지 않은 칸
function nextNonEmpty(row, i) {
  for (let j = i + 1; j < row.length; j++) {
    const v = (row[j] || "").toString().trim();
    if (v) return v;
  }
  return "";
}

// 신청 교사 섹션 파싱 → [{name, role, phone}]
function parseTeachers(rows) {
  let hIdx = -1, c = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map(x => (x || "").toString().trim());
    if (r.includes("이름") && r.includes("역할")) {
      hIdx = i; c.name = r.indexOf("이름"); c.role = r.indexOf("역할"); c.phone = r.indexOf("전화");
      break;
    }
  }
  if (hIdx < 0) return [];
  const out = [];
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const nm = (r[c.name] || "").toString().trim();
    if (!nm) break;
    if (nm === "예시" || nm === "이름") continue;
    out.push({
      name: nm,
      role: (r[c.role] || "").toString().trim(),
      phone: (c.phone >= 0 ? (r[c.phone] || "") : "").toString().trim()
    });
  }
  return out;
}

// ---------- 명단 파싱 ----------
// 반환: { sheet, school, program, courseLevel, students, teachers, mainTeacher }
export function parseRoster(workbook) {
  const result = [];
  for (const sheetName of workbook.SheetNames) {
    if (/삭제\s*금지|Sheet1/i.test(sheetName)) continue;
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

    // 메타: 교육 장소 / 프로그램명 찾기 (라벨 이후 첫 비어있지 않은 칸)
    let school = "", program = "";
    for (const r of rows.slice(0, 6)) {
      for (let i = 0; i < r.length; i++) {
        const v = (r[i] || "").toString().trim();
        if (v === "교육 장소") school = nextNonEmpty(r, i);
        if (v === "프로그램명") program = nextNonEmpty(r, i);
      }
    }
    // 표준 양식의 placeholder는 무시
    if (/^학교\/기관명$/.test(school)) school = "";

    // 헤더 행(이름/전화) 찾기
    let hIdx = -1, col = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].map(x => (x || "").toString().trim());
      if (r.includes("이름") && r.includes("전화") && !r.includes("역할")) {
        hIdx = i;
        col.no = r.indexOf("No");
        col.name = r.indexOf("이름");
        col.phone = r.indexOf("전화");
        col.school = r.indexOf("학교");
        col.grade = r.indexOf("학년");
        col.start = r.findIndex(x => x.startsWith("교육시작"));
        col.end = r.findIndex(x => x.startsWith("교육종료"));
        col.memo = r.indexOf("메모(특이사항)");
        if (col.memo < 0) col.memo = r.findIndex(x => x.startsWith("메모"));
        break;
      }
    }
    if (hIdx < 0) continue;

    const students = [];
    let startDate = "", endDate = "";
    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const nm = (r[col.name] || "").toString().trim();
      const nov = (col.no >= 0 ? (r[col.no] || "") : "").toString().trim();
      if (nov === "예시" || /^홍\*동$/.test(nm)) continue;   // 예시 행 건너뜀
      if (!nm) break;                                        // 빈 줄이면 명단 끝
      if (/신청\s*교사|문의|^No$|^이름$/.test(nm)) break;    // 교사 섹션 진입
      if (!startDate && col.start >= 0) startDate = (r[col.start] || "").toString().trim();
      if (col.end >= 0) { const ev = (r[col.end] || "").toString().trim(); if (ev) endDate = ev; }
      students.push({
        name: nm,
        phone: (r[col.phone] || "").toString().trim(),
        school: (r[col.school] || school || "").toString().trim(),
        grade: (r[col.grade] || "").toString().trim(),
        memo: (col.memo >= 0 ? (r[col.memo] || "") : "").toString().trim()
      });
    }

    // 신청 교사(주강사/보조강사/안전관리) 추출
    const teachers = parseTeachers(rows);
    const byRole = re => (teachers.find(t => re.test(t.role)) || {}).name || "";
    const mainTeacher = byRole(/주강사/);
    const assistantTeacher = byRole(/보조/);
    const safetyManager = byRole(/안전/);

    result.push({
      sheet: sheetName,
      school: school,
      program: program,
      courseType: courseTypeFromProgram(program),    // 기본/특화/AI특화
      courseLevel: courseLevelFromProgram(program),   // 초저/초고/중등...
      startDate, endDate,
      dates: dateRange(startDate, endDate),           // [{m,d}, ...]
      students, teachers, mainTeacher, assistantTeacher, safetyManager
    });
  }
  return result;
}

// ---------- 변환: 명단 학생 -> 등록양식 행 (클래스별 분리) ----------
// 오전반/오후반 등 학생이 있는 클래스마다 별도 결과를 만든다.
// 클래스 수 = 명단에서 학생이 있는 시트 수 (원데이터 기준).
// regionResolver.resolve(school) -> {sido, source}
// opts.socialByClass: { [className]: true } — 다문화/사회배려 학급 수동 체크
export async function toRegistrationRows(blocks, regionResolver, opts = {}) {
  const socialByClass = opts.socialByClass || {};
  const classes = [];
  for (const blk of blocks) {
    if (!blk.students.length) continue;   // 학생 없는 클래스는 제외
    // 체크박스 우선, 없으면 프로그램명 자동감지
    const social = (blk.sheet in socialByClass)
      ? !!socialByClass[blk.sheet]
      : isSocialClass(blk.program, blk.courseLevel);
    const rows = [];
    const regionLog = [];
    for (const s of blk.students) {
      const level = schoolLevel(s.school, blk.courseLevel);
      const reg = await regionResolver.resolve(s.school);
      regionLog.push({ school: s.school, sido: reg.sido, source: reg.source });
      rows.push({
        "학생명": anonymizeName(s.name),
        "연락처": formatPhone(s.phone),
        "이메일": randomEmail(),
        "지역": reg.sido,
        "학교": s.school,
        "학년": gradeText(s.grade, level),
        "반": randomClass(),
        "일반학생 여부": generalStudentFlag(s.memo, social)
      });
    }
    classes.push({
      className: blk.sheet,   // "오전반" / "오후반"
      school: blk.school,
      program: blk.program,
      rows,
      regionLog
    });
  }
  return classes;
}

// ---------- 등록양식 xlsx 생성 (템플릿 채우기, 텍스트 서식 보존) ----------
const COLS = ["학생명", "연락처", "이메일", "지역", "학교", "학년", "반", "일반학생 여부"];
const COL_LETTER = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COL_STYLE  = { A: "2", B: "3", C: "5", D: "2", E: "2", F: "2", G: "2", H: "2" }; // 템플릿 텍스트 서식

function xmlEsc(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// templateBuf: 양식 xlsx ArrayBuffer
export async function buildRegistrationXlsx(templateBuf, rows) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "xl/worksheets/sheet1.xml";
  let xml = await zip.file(path).async("string");

  // 기존 sheetData에서 1행(헤더) 보존
  const sdMatch = xml.match(/<sheetData>([\s\S]*?)<\/sheetData>/);
  const header1 = (sdMatch && sdMatch[1].match(/<row r="1"[\s\S]*?<\/row>/)) ?
    sdMatch[1].match(/<row r="1"[\s\S]*?<\/row>/)[0] : "";

  let body = header1;
  rows.forEach((row, idx) => {
    const r = idx + 2;
    let cells = "";
    COL_LETTER.forEach((L, ci) => {
      const val = row[COLS[ci]];
      if (val === "" || val == null) return;       // 빈 셀은 생략
      cells += `<c r="${L}${r}" s="${COL_STYLE[L]}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(val)}</t></is></c>`;
    });
    body += `<row r="${r}" spans="1:9">${cells}</row>`;
  });

  xml = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${body}</sheetData>`);
  const lastRow = rows.length + 1;
  xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:I${lastRow}"/>`);

  zip.file(path, xml);
  return await zip.generateAsync({ type: "blob", mimeType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
