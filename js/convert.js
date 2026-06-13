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

// ---------- 명단 파싱 ----------
// 반환: { sheet, school, program, courseLevel, students:[{name,phone,school,grade,memo}] }
export function parseRoster(workbook) {
  const result = [];
  for (const sheetName of workbook.SheetNames) {
    if (/삭제\s*금지|Sheet1/i.test(sheetName)) continue;
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });

    // 메타: 교육 장소 / 프로그램명 찾기
    let school = "", program = "";
    for (const r of rows.slice(0, 6)) {
      for (let i = 0; i < r.length; i++) {
        const v = (r[i] || "").toString().trim();
        if (v === "교육 장소") school = (r[i+1] || "").toString().trim();
        if (v === "프로그램명") program = (r[i+1] || r[i+2] || "").toString().trim();
      }
    }

    // 헤더 행(이름/전화) 찾기
    let hIdx = -1, col = {};
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].map(x => (x || "").toString().trim());
      if (r.includes("이름") && r.includes("전화")) {
        hIdx = i;
        col.name = r.indexOf("이름");
        col.phone = r.indexOf("전화");
        col.school = r.indexOf("학교");
        col.grade = r.indexOf("학년");
        col.memo = r.indexOf("메모(특이사항)");
        if (col.memo < 0) col.memo = r.findIndex(x => x.startsWith("메모"));
        break;
      }
    }
    if (hIdx < 0) continue;

    const students = [];
    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const nm = (r[col.name] || "").toString().trim();
      if (!nm) break;                              // 빈 줄이면 명단 끝
      if (/신청\s*교사|문의|^No$|^이름$/.test(nm)) break;  // 교사 섹션 진입
      students.push({
        name: nm,
        phone: (r[col.phone] || "").toString().trim(),
        school: (r[col.school] || school || "").toString().trim(),
        grade: (r[col.grade] || "").toString().trim(),
        memo: (col.memo >= 0 ? (r[col.memo] || "") : "").toString().trim()
      });
    }

    result.push({
      sheet: sheetName,
      school: school,
      program: program,
      courseLevel: courseLevelFromProgram(program),
      students
    });
  }
  return result;
}

// ---------- 변환: 명단 학생 -> 등록양식 행 (클래스별 분리) ----------
// 오전반/오후반 등 학생이 있는 클래스마다 별도 결과를 만든다.
// 클래스 수 = 명단에서 학생이 있는 시트 수 (원데이터 기준).
// regionResolver.resolve(school) -> {sido, source}
export async function toRegistrationRows(blocks, regionResolver, opts = {}) {
  const classes = [];
  for (const blk of blocks) {
    if (!blk.students.length) continue;   // 학생 없는 클래스는 제외
    const social = isSocialClass(blk.program, blk.courseLevel);
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
