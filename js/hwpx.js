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

// ---------- 교구 관리대장 / 결과보고서 (플레이스홀더 치환형) ----------
const pad2 = (n) => String(n).padStart(2, "0");
// "09:00" -> "09시 00분"
function fmtTime(s) {
  const m = (s || "").match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  return m ? `${pad2(m[1])}시 ${pad2(m[2])}분` : "00시 00분";
}
const rgEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// header.xml의 charPr을 검정(#000000) 복제본으로 만들어 id를 돌려주는 클로저
// (폼마다 같은 charPr이 다른 용도로 쓰여 전역 색변경은 위험 → 채우는 run만 교체)
function makeBlackCloner(header) {
  let maxId = Math.max(...[...header.xml.matchAll(/<hh:charPr id="(\d+)"/g)].map(m => +m[1]));
  const cache = {};
  return {
    get xml() { return header.xml; },
    black(cid) {
      if (cache[cid]) return cache[cid];
      const m = header.xml.match(new RegExp(`<hh:charPr id="${cid}"[\\s\\S]*?</hh:charPr>`));
      if (!m) return cid;
      const block = m[0];
      const color = block.match(/textColor="([^"]+)"/);
      if (color && color[1].toUpperCase() === "#000000") { cache[cid] = cid; return cid; } // 이미 검정
      const newId = ++maxId;
      let clone = block.replace(`id="${cid}"`, `id="${newId}"`);
      clone = color ? clone.replace(/textColor="[^"]+"/, 'textColor="#000000"')
                    : clone.replace(/(<hh:charPr id="\d+")/, '$1 textColor="#000000"');
      header.xml = header.xml.replace(block, block + clone)
        .replace(/(<hh:charProperties itemCnt=")(\d+)(")/, (mm, a, n, b) => a + (+n + 1) + b);
      cache[cid] = newId;
      return newId;
    }
  };
}

// 특정 텍스트를 담은 run을 찾아 텍스트 교체 + 글자색 검정으로.
// ① run 단위(charPr 검정 교체) 처리 후 ② 남은 동일 텍스트는 텍스트만 교체(누락 방지)
function fillFieldBlack(xml, cloner, oldText, newText) {
  const runRe = new RegExp(`<hp:run charPrIDRef="(\\d+)"><hp:t>${rgEsc(oldText)}</hp:t></hp:run>`, "g");
  xml = xml.replace(runRe, (m, cid) =>
    `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(newText)}</hp:t></hp:run>`);
  // run 구조가 다른 잔여분 보완
  return xml.replace(new RegExp(`<hp:t>${rgEsc(oldText)}</hp:t>`, "g"), `<hp:t>${xmlEsc(newText)}</hp:t>`);
}

// 특정 텍스트를 담은 <hp:p> 단락 통째 삭제
function removeParagraphWith(xml, text) {
  const re = new RegExp(`<hp:p\\b[^>]*>(?:(?!</hp:p>)[\\s\\S])*?<hp:t>${rgEsc(text)}</hp:t>(?:(?!</hp:p>)[\\s\\S])*?</hp:p>`, "g");
  return xml.replace(re, "");
}

// 디싹 양식 공통 플레이스홀더 채우기 (교구관리대장·결과보고서 공용)
// data: { program, school, org, mainTeacher, equipQty, year, days:[{date:{m,d}, start, end}] }
function fillPlaceholders(xml, cloner, data) {
  const days = (data.days || []).filter(d => d && d.date);
  const year = data.year || 2026;
  const first = days[0]?.date, last = days[days.length - 1]?.date;

  // 안내 문구 삭제
  xml = removeParagraphWith(xml, "*일차별 교육일시 모두 작성");
  xml = removeParagraphWith(xml, "* 주강사 성함 및 서명 해주세요.");

  // 일차별 운영일시: 단락 단위. 사용 일차는 채우고(검정), 미사용 일차는 단락 삭제 → 줄 수 자동 축소
  xml = xml.replace(
    /<hp:p\b[^>]*>(?:(?!<\/hp:p>)[\s\S])*?<hp:t>\((\d)일차\) 00월 00일 \/ 00시 00분 ~ 00시 00분\s*<\/hp:t>(?:(?!<\/hp:p>)[\s\S])*?<\/hp:p>/g,
    (para, k) => {
      const idx = +k - 1;
      if (idx >= days.length) return "";   // 미사용 일차 단락 제거
      const d = days[idx];
      const label = `(${k}일차) ${pad2(d.date.m)}월 ${pad2(d.date.d)}일 / ${fmtTime(d.start)} ~ ${fmtTime(d.end)}`;
      return para.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>\(\d일차\)[^<]*<\/hp:t><\/hp:run>/,
        (r, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(label)}</hp:t></hp:run>`);
    });

  // 프로그램명 / 교육장소 / 교구수량 (검정)
  if (data.program) xml = fillFieldBlack(xml, cloner, "프로그램명 작성해주세요", data.program);
  if (data.school) {
    xml = fillFieldBlack(xml, cloner, "00초등학교 (교육장소명)", data.school);
    xml = fillFieldBlack(xml, cloner, "교육장소를 작성해주세요", data.school);
    xml = fillFieldBlack(xml, cloner, "00초등학교", data.school);
  }
  if (data.equipQty) xml = fillFieldBlack(xml, cloner, "00개", `${data.equipQty}개`);

  if (first && last) {
    const period = `${year}년 ${pad2(first.m)}월 ${pad2(first.d)}일 ~ ${pad2(last.m)}월 ${pad2(last.d)}일`;
    const fd = days[0];
    // 운영기간(+시간 변형) — 더 긴 패턴 먼저
    xml = fillFieldBlack(xml, cloner, "2026년 00월 00일 ~ 00월 00일 / 00시 00분 ~ 00시 00분",
      `${period} / ${fmtTime(fd.start)} ~ ${fmtTime(fd.end)}`);
    xml = fillFieldBlack(xml, cloner, "2026년 00월 00일 ~ 00월 00일", period);
    // 교구관리대장: 수령일시=시작일, 제출일=마지막일
    xml = fillFieldBlack(xml, cloner, "2026.00.00 (캠프 시작일)", `${year}.${pad2(first.m)}.${pad2(first.d)} (캠프 시작일)`);
    xml = fillFieldBlack(xml, cloner, "2026. 00. 00.", `${year}. ${pad2(last.m)}. ${pad2(last.d)}.`);
  }

  if (data.org) {
    xml = xml.replace(/한국과학창의재단 \/ 대림대학교 \//g, `한국과학창의재단 / ${xmlEsc(data.org)} /`);
  }
  if (data.mainTeacher) {
    xml = xml.replace(/ㅇ ㅇ ㅇ/g, xmlEsc(data.mainTeacher));
    xml = fillFieldBlack(xml, cloner, "(주강사 성명)                            (서명)",
      `${data.mainTeacher}                            (서명)`);
  }
  return xml;
}

async function buildPlaceholderHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const secPath = "Contents/section0.xml";
  const hdrPath = "Contents/header.xml";
  let xml = await zip.file(secPath).async("string");
  const header = { xml: await zip.file(hdrPath).async("string") };
  const cloner = makeBlackCloner(header);

  xml = fillPlaceholders(xml, cloner, data);

  zip.file(secPath, xml);
  zip.file(hdrPath, header.xml);   // 검정 charPr 복제본 반영
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
