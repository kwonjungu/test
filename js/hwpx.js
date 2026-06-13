// 수령대장(서명 대장) hwpx 생성기
// 의존: 전역 JSZip
//
// hwpx는 zip+XML 패키지. Contents/section0.xml의 표(hp:tbl)에
// - 성명: colAddr="1" rowAddr=2..26 셀의 빈 run에 학생명 주입
// - 날짜헤더: colAddr>=2 rowAddr=0 셀의 "(N일차) 월 일"을 실제 날짜로 치환
// 표는 2개(8차시: 수기서명 2개 / 12차시: 수기서명 4개) → 차시에 맞는 표만 채움.

function xmlEsc(s) {
  return (s ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 한 표(tbl 문자열)에 이름/날짜 채우기
function fillTable(tbl, names, dates) {
  return tbl.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    const a = tc.match(/colAddr="(\d+)" rowAddr="(\d+)"/);
    if (!a) return tc;
    const col = +a[1], row = +a[2];

    // 성명 (col1, 데이터행 row2~26)
    if (col === 1 && row >= 2 && row <= 26) {
      const idx = row - 2;
      if (idx < names.length && names[idx]) {
        // 빈 self-closing run에 텍스트 주입 (charPrIDRef 보존)
        return tc.replace(/<hp:run charPrIDRef="(\d+)"\/>/,
          `<hp:run charPrIDRef="$1"><hp:t>${xmlEsc(names[idx])}</hp:t></hp:run>`);
      }
      return tc;
    }

    // 날짜 헤더 (col>=2, row0)
    if (col >= 2 && row === 0) {
      const di = col - 2;
      if (di < dates.length && dates[di]) {
        const label = `${dates[di].m}월 ${dates[di].d}일`;
        // 표0형: "(N일차)   월   일" 단일 노드
        let tc2 = tc.replace(/(\(\d일차\))\s*월\s*일/, `$1 ${label}`);
        // 표1형: "   월   일" 별도 노드
        if (tc2 === tc) tc2 = tc.replace(/<hp:t>\s*월\s*일<\/hp:t>/, `<hp:t> ${label}</hp:t>`);
        return tc2;
      }
    }
    return tc;
  });
}

// chasi: 8 | 12, names: 실명 배열, dates: [{m,d}, ...]
export async function buildReceiptHwpx(templateBuf, { names, chasi, dates }) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");

  // 표 위치 추출
  const tbls = [];
  const re = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/g;
  let m;
  while ((m = re.exec(xml)) !== null) tbls.push({ start: m.index, end: re.lastIndex, text: m[0] });

  // 차시에 맞는 표만 채움: 수기서명 2개=8차시, 4개=12차시
  const signCount = (s) => (s.match(/수기 서명/g) || []).length;
  for (let i = tbls.length - 1; i >= 0; i--) {
    const t = tbls[i];
    const sc = signCount(t.text);
    const isTarget = (chasi === 8 && sc === 2) || (chasi === 12 && sc === 4)
      || (chasi !== 8 && chasi !== 12 && i === 0);  // 알 수 없으면 첫 표
    if (isTarget) {
      const filled = fillTable(t.text, names, dates);
      xml = xml.slice(0, t.start) + filled + xml.slice(t.end);
    }
  }

  zip.file(path, xml);
  return packageHwpx(zip);
}

// ---------- hwpx(OCF) 패키징 (한글 호환) ----------
// mimetype은 STORE(무압축)·첫 엔트리 유지, 나머지는 DEFLATE.
// JSZip이 자동 추가하는 폴더 엔트리(Contents/ 등)는 원본에 없으므로 제거.
async function packageHwpx(zip) {
  const mt = await zip.file("mimetype").async("uint8array");
  zip.file("mimetype", mt, { compression: "STORE" });  // 키 재지정은 순서 보존
  for (const k of Object.keys(zip.files)) {
    if (zip.files[k].dir) delete zip.files[k];
  }
  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/hwp+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  });
}

// ---------- 교구 관리대장 (플레이스홀더 치환형) ----------
const pad2 = (n) => String(n).padStart(2, "0");
// "09:00" -> "09시 00분"
function fmtTime(s) {
  const m = (s || "").match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  return m ? `${pad2(m[1])}시 ${pad2(m[2])}분` : "00시 00분";
}
// <hp:t>OLD</hp:t> 형태 정확매칭 전체 치환
function replaceNode(xml, oldText, newText) {
  const esc = oldText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return xml.replace(new RegExp(`<hp:t>${esc}</hp:t>`, "g"),
    `<hp:t>${xmlEsc(newText)}</hp:t>`);
}

// 디싹 양식 공통 플레이스홀더 채우기 (교구관리대장·결과보고서 공용)
// data: { program, school, org, mainTeacher, equipQty, year, days:[{date:{m,d}, start, end}] }
function fillPlaceholders(xml, data) {
  const days = (data.days || []).filter(d => d && d.date);
  const year = data.year || 2026;
  const first = days[0]?.date, last = days[days.length - 1]?.date;

  // 일차별 운영일시: "(K일차) 00월 00일 / 00시 00분 ~ 00시 00분" 노드 일괄 치환
  xml = xml.replace(/<hp:t>\((\d)일차\)\s*00월 00일 \/ 00시 00분 ~ 00시 00분\s*<\/hp:t>/g,
    (full, k) => {
      const idx = +k - 1;
      if (idx < days.length) {
        const d = days[idx];
        return `<hp:t>(${k}일차) ${pad2(d.date.m)}월 ${pad2(d.date.d)}일 / ${fmtTime(d.start)} ~ ${fmtTime(d.end)}</hp:t>`;
      }
      return `<hp:t></hp:t>`;   // 사용하지 않는 일차는 비움
    });

  // 프로그램명 / 교육장소 / 교구수량
  if (data.program) xml = replaceNode(xml, "프로그램명 작성해주세요", data.program);
  if (data.school) {
    xml = replaceNode(xml, "00초등학교 (교육장소명)", data.school);
    xml = replaceNode(xml, "교육장소를 작성해주세요", data.school);
    xml = replaceNode(xml, "00초등학교", data.school);
  }
  if (data.equipQty) xml = replaceNode(xml, "00개", `${data.equipQty}개`);

  if (first && last) {
    const period = `${year}년 ${pad2(first.m)}월 ${pad2(first.d)}일 ~ ${pad2(last.m)}월 ${pad2(last.d)}일`;
    xml = replaceNode(xml, "2026년 00월 00일 ~ 00월 00일", period);
    // 결과보고서: 운영기간 + 시간(첫날 기준)
    const fd = days[0];
    xml = replaceNode(xml, "2026년 00월 00일 ~ 00월 00일 / 00시 00분 ~ 00시 00분",
      `${period} / ${fmtTime(fd.start)} ~ ${fmtTime(fd.end)}`);
    // 교구관리대장: 수령일시=시작일, 제출일=마지막일
    xml = replaceNode(xml, "2026.00.00 (캠프 시작일)", `${year}.${pad2(first.m)}.${pad2(first.d)} (캠프 시작일)`);
    xml = replaceNode(xml, "2026. 00. 00.", `${year}. ${pad2(last.m)}. ${pad2(last.d)}.`);
  }

  if (data.org) {
    xml = xml.replace(/한국과학창의재단 \/ 대림대학교 \//g, `한국과학창의재단 / ${xmlEsc(data.org)} /`);
  }
  if (data.mainTeacher) {
    xml = xml.replace(/ㅇ ㅇ ㅇ/g, xmlEsc(data.mainTeacher));
    xml = replaceNode(xml, "(주강사 성명)                            (서명)",
      `${data.mainTeacher}                            (서명)`);
  }
  return xml;
}

async function buildPlaceholderHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  xml = fillPlaceholders(xml, data);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// 교구 관리대장
export function buildEquipmentLedgerHwpx(templateBuf, data) {
  return buildPlaceholderHwpx(templateBuf, data);
}

// 결과보고서 (보조강사 취합 서류) — 프로그램명/교육장소/회차별 운영일시/운영기간 채움
export function buildReportHwpx(templateBuf, data) {
  return buildPlaceholderHwpx(templateBuf, data);
}
