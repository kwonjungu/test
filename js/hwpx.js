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

// 한 표(tbl 문자열)에 이름/날짜 채우기 (채운 글자는 검정·11pt·함초롬바탕 통일)
function fillTable(tbl, names, dates, cloner) {
  return tbl.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    const a = tc.match(/colAddr="(\d+)" rowAddr="(\d+)"/);
    if (!a) return tc;
    const col = +a[1], row = +a[2];

    // 성명 (col1, 데이터행 row2~26)
    if (col === 1 && row >= 2 && row <= 26) {
      const idx = row - 2;
      if (idx < names.length && names[idx]) {
        return tc.replace(/<hp:run charPrIDRef="(\d+)"\/>/,
          (mm, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(names[idx])}</hp:t></hp:run>`);
      }
      return tc;
    }

    // 날짜 헤더 (col>=2, row0)
    if (col >= 2 && row === 0) {
      const di = col - 2;
      if (di < dates.length && dates[di]) {
        const label = `${dates[di].m}월 ${dates[di].d}일`;
        let tc2 = tc;
        // 표0형: 한 run의 "(N일차)   월   일"
        tc2 = tc2.replace(/<hp:run charPrIDRef="(\d+)">(<hp:t>)(\(\d일차\))\s*월\s*일(<\/hp:t>)<\/hp:run>/,
          (mm, cid, o, pre, c) => `<hp:run charPrIDRef="${cloner.black(cid)}">${o}${pre} ${label}${c}</hp:run>`);
        // 표1형: " 월 일"만 별도 run
        if (tc2 === tc) tc2 = tc2.replace(/<hp:run charPrIDRef="(\d+)">(<hp:t>)\s*월\s*일(<\/hp:t>)<\/hp:run>/,
          (mm, cid, o, c) => `<hp:run charPrIDRef="${cloner.black(cid)}">${o} ${label}${c}</hp:run>`);
        // 표1형: "(N일차)" 단독 run도 검정 통일
        tc2 = tc2.replace(/<hp:run charPrIDRef="(\d+)">(<hp:t>\(\d일차\)<\/hp:t>)<\/hp:run>/,
          (mm, cid, inner) => `<hp:run charPrIDRef="${cloner.black(cid)}">${inner}</hp:run>`);
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
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);

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
      const filled = fillTable(t.text, names, dates, cloner);
      xml = xml.slice(0, t.start) + filled + xml.slice(t.end);
    }
  }

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
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
  // lang 그룹별 '함초롬바탕' 폰트 id 수집 (서류마다 id가 다름)
  const fontIds = {};
  for (const fm of header.xml.matchAll(/<hh:fontface lang="([^"]+)"[^>]*>([\s\S]*?)<\/hh:fontface>/g)) {
    const f = fm[2].match(/<hh:font id="(\d+)"[^>]*face="함초롬바탕"/);
    if (f) fontIds[fm[1].toLowerCase()] = f[1];
  }
  return {
    get xml() { return header.xml; },
    // 채워넣는 글자 통일: 검정(#000000) + 11pt(height 1100) + 함초롬바탕 + 정자체(기울임/밑줄/취소선 제거)
    black(cid) {
      if (cache[cid] != null) return cache[cid];
      const m = header.xml.match(new RegExp(`<hh:charPr id="${cid}"[\\s\\S]*?</hh:charPr>`));
      if (!m) return cid;
      const block = m[0];
      const color = block.match(/textColor="([^"]+)"/);
      const height = block.match(/\bheight="(\d+)"/);
      const fr = block.match(/<hh:fontRef\b[^>]*hangul="(\d+)"/);
      const isBlack = color && color[1].toUpperCase() === "#000000";
      const is11 = height && height[1] === "1100";
      const isFont = fr && fontIds.hangul != null && fr[1] === fontIds.hangul;
      const noItalic = !/<hh:italic\/>/.test(block);
      if (isBlack && is11 && isFont && noItalic) { cache[cid] = cid; return cid; }
      const newId = ++maxId;
      let clone = block.replace(`id="${cid}"`, `id="${newId}"`);
      clone = color ? clone.replace(/textColor="[^"]+"/, 'textColor="#000000"')
                    : clone.replace(/(<hh:charPr id="\d+")/, '$1 textColor="#000000"');
      clone = height ? clone.replace(/\bheight="\d+"/, 'height="1100"')
                     : clone.replace(/(<hh:charPr id="\d+")/, '$1 height="1100"');
      // 폰트(fontRef 각 lang)를 함초롬바탕으로
      clone = clone.replace(/<hh:fontRef\b[^>]*\/>/, f =>
        f.replace(/(hangul|latin|hanja|japanese|other|symbol|user)="\d+"/g,
          (a, lang) => fontIds[lang] != null ? `${lang}="${fontIds[lang]}"` : a));
      // 정자체화: 기울임 제거, 밑줄·취소선 없음
      clone = clone.replace(/<hh:italic\/>/, "");
      clone = clone.replace(/<hh:underline\b[^/]*\/>/, '<hh:underline type="NONE" shape="SOLID" color="#000000"/>');
      clone = clone.replace(/<hh:strikeout\b[^/]*\/>/, '<hh:strikeout shape="NONE" color="#000000"/>');
      header.xml = header.xml.replace(block, block + clone)
        .replace(/(<hh:charProperties itemCnt=")(\d+)(")/, (mm, a, n, b) => a + (+n + 1) + b);
      cache[cid] = newId;
      return newId;
    },
    // 색만 검정으로(크기·폰트·볼드 유지) — 라벨용
    colorBlack(cid) {
      const key = "c" + cid;
      if (cache[key] != null) return cache[key];
      const m = header.xml.match(new RegExp(`<hh:charPr id="${cid}"[\\s\\S]*?</hh:charPr>`));
      if (!m) return cid;
      const block = m[0];
      const color = block.match(/textColor="([^"]+)"/);
      if (color && color[1].toUpperCase() === "#000000") { cache[key] = cid; return cid; }
      const newId = ++maxId;
      let clone = block.replace(`id="${cid}"`, `id="${newId}"`);
      clone = color ? clone.replace(/textColor="[^"]+"/, 'textColor="#000000"')
                    : clone.replace(/(<hh:charPr id="\d+")/, '$1 textColor="#000000"');
      header.xml = header.xml.replace(block, block + clone)
        .replace(/(<hh:charProperties itemCnt=")(\d+)(")/, (mm, a, n, b) => a + (+n + 1) + b);
      cache[key] = newId;
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

  // 드롭다운 옵션 목록만 비움(프로그램명 값으로 채울 "해당 프로그램명 작성"은 보존).
  // 프로그램 채우기 전에 실행(채운 프로그램명이 옵션 패턴과 겹칠 수 있음)
  xml = xml.replace(/<hp:t>\((?:기본|특화|AI특화)\/[^<]*<\/hp:t>/g, "<hp:t></hp:t>");

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

  // 프로그램명 (검정). 양식별 표시칸이 "해당 프로그램명 작성"(교구관리대장) 또는
  // "프로그램명 작성해주세요"(안전업무일지 등)로 달라 둘 다 채움
  if (data.program) {
    xml = fillFieldBlack(xml, cloner, "해당 프로그램명 작성", data.program);
    xml = fillFieldBlack(xml, cloner, "프로그램명 작성해주세요", data.program);
  } else {
    xml = xml.replace(/<hp:t>해당 프로그램명 작성<\/hp:t>/g, "<hp:t></hp:t>");
  }
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
  // 안전관리자 성명 (안전업무일지) — 공백 폭 보존, 검정
  if (data.safetyManager) {
    const nm = xmlEsc(data.safetyManager);
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>\(안전관리자 성명\)([\s ]*)\(서명\)<\/hp:t><\/hp:run>/g,
      (mm, cid, sp) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${nm}${sp}(서명)</hp:t></hp:run>`);
    xml = xml.replace(/<hp:t>\(안전관리자 성명\)([\s ]*)\(서명\)<\/hp:t>/g,
      (mm, sp) => `<hp:t>${nm}${sp}(서명)</hp:t>`);
  }
  // 보조강사 성명 (결과보고서 식다과·교재 수령대장 확인자) — 공백 폭 보존, 검정
  if (data.assistantTeacher) {
    const _an = xmlEsc(data.assistantTeacher);
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>\(보조강사 성명\)([\s\S]*?)\(서명\)<\/hp:t><\/hp:run>/g,
      (mm, cid, sp) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${_an}${sp}(서명)</hp:t></hp:run>`);
  }
  // 표 라벨 검정 보장 (크기·볼드 유지, 색만 검정)
  const LABELS = ["프로그램명", "교육기간", "운영기간", "운영일시", "운영기관", "확인자",
    "교육장소", "교육대상", "수령일시", "제출일", "담당자", "교구 수량", "교구 수령 사진"];
  for (const lab of LABELS) {
    xml = xml.replace(new RegExp(`<hp:run charPrIDRef="(\\d+)"><hp:t>(${rgEsc(lab)})</hp:t></hp:run>`, "g"),
      (mm, cid, t) => `<hp:run charPrIDRef="${cloner.colorBlack(cid)}"><hp:t>${t}</hp:t></hp:run>`);
  }
  return xml;
}

async function buildPlaceholderHwpx(templateBuf, data, preprocess, postprocess) {
  const zip = await JSZip.loadAsync(templateBuf);
  const secPath = "Contents/section0.xml";
  const hdrPath = "Contents/header.xml";
  let xml = await zip.file(secPath).async("string");
  const header = { xml: await zip.file(hdrPath).async("string") };
  const cloner = makeBlackCloner(header);

  if (preprocess) xml = preprocess(xml, data);   // 회차 블록 확장/삭제 등
  xml = fillPlaceholders(xml, cloner, data);
  if (postprocess) xml = postprocess(xml, cloner, data);

  zip.file(secPath, xml);
  zip.file(hdrPath, header.xml);   // 검정 charPr 복제본 반영
  return packageHwpx(zip);
}

// ---------- 결과보고서 회차 블록 확장/삭제 ----------
// 본문 최상위 요소(<hp:p>/<hp:tbl>) 순회 (깊이 추적)
function topLevelEls(xml, start) {
  const out = [];
  const open = /<(hp:p|hp:tbl)\b/g;
  open.lastIndex = start;
  let m;
  while ((m = open.exec(xml))) {
    const tag = m[1], j = m.index;
    const pat = new RegExp(`</?${tag}\\b`, "g");
    pat.lastIndex = j;
    let depth = 0, k = j, mm;
    while ((mm = pat.exec(xml))) {
      if (xml[mm.index + 1] === "/") { if (--depth === 0) { k = mm.index + mm[0].length; break; } }
      else depth++;
      k = pat.lastIndex;
    }
    const end = xml.indexOf(">", k - 1) >= 0 ? k : xml.length;
    out.push({ start: j, end, tag, text: [...xml.slice(j, end).matchAll(/<hp:t>(.*?)<\/hp:t>/g)].map(x => x[1]).join("") });
    open.lastIndex = end;
  }
  return out;
}

// 회차별 결과보고 블록을 일수에 맞게 확장(>4)·삭제(<4)
function expandReportRounds(xml, data) {
  const days = (data.days || []).filter(d => d && d.date);
  const D = days.length;
  if (!D) return xml;

  const secm = xml.match(/<hs:sec\b[^>]*>/);
  const els = topLevelEls(xml, secm ? secm.index + secm[0].length : 0);
  const rounds = els.filter(e => /\d회차 결과보고/.test(e.text))
    .map(e => ({ ...e, n: +e.text.match(/(\d)회차 결과보고/)[1] }))
    .sort((a, b) => a.n - b.n);
  if (rounds.length < 4) return xml;          // 표준 4회차 양식이 아니면 건너뜀
  const gisa = els.find(e => /기타 운영사항/.test(e.text));
  if (!gisa) return xml;

  // 회차4 블록(헤더~사진표) = 회차4 헤더 시작 ~ "3.기타운영사항" 시작 사이
  const r4 = rounds[3];
  const block4 = xml.slice(r4.start, gisa.start);   // 회차4 + 후행 빈단락 포함

  let maxId = Math.max(...[...xml.matchAll(/\bid="(\d{6,})"/g)].map(x => +x[1]), 0);
  let maxZ = Math.max(...[...xml.matchAll(/zOrder="(\d+)"/g)].map(x => +x[1]), 0);

  if (D <= 4) {
    // 초과 회차(D+1..4) 블록 삭제: rounds[D] 시작 ~ gisa 시작
    if (D < 4) xml = xml.slice(0, rounds[D].start) + xml.slice(gisa.start);
    return xml;
  }

  // D>4: 회차4 블록을 복제해 5..D회차 생성 (새 페이지·회차/일차 번호·표 id 갱신)
  let clones = "";
  for (let k = 5; k <= D; k++) {
    let c = block4
      .replace(/<hp:t>4회차<\/hp:t>/g, `<hp:t>${k}회차</hp:t>`)
      .replace(/\(4일차\) 00월 00일/g, `(${k}일차) 00월 00일`)
      .replace(/\bid="(\d{6,})"/g, () => `id="${++maxId}"`)
      .replace(/zOrder="\d+"/g, () => `zOrder="${++maxZ}"`);
    // 다음 페이지로: 첫 단락에 pageBreak 적용
    c = c.replace(/(<hp:p\b[^>]*?)pageBreak="0"/, '$1pageBreak="1"');
    clones += c;
  }
  // 회차4 블록 직후(=gisa 시작 직전)에 삽입
  return xml.slice(0, gisa.start) + clones + xml.slice(gisa.start);
}

// 교구 관리대장
export function buildEquipmentLedgerHwpx(templateBuf, data) {
  return buildPlaceholderHwpx(templateBuf, data);
}

// 결과보고서 '4. 프로그램 추진 의견'의 주/보조/안전 라벨 단락 뒤에 AI 의견 단락 삽입
// data.opinions = { 주강사, 보조강사, 안전관리자 } (없는 항목은 건너뜀)
function fillReportOpinions(xml, cloner, data) {
  const ops = data.opinions || {};
  const labels = { "주강사": "(주강사 작성용)", "보조강사": "(보조강사 작성용)", "안전관리자": "(안전관리자 작성용)" };
  for (const role of Object.keys(labels)) {
    const text = (ops[role] || "").trim();
    if (!text) continue;
    // 라벨 셀(▶ …작성용…) 바로 다음 빈 셀(작성칸)에 주입
    const li = xml.indexOf(labels[role]);
    if (li < 0) continue;
    const labEnd = xml.indexOf("</hp:tc>", li);
    if (labEnd < 0) continue;
    const ns = xml.indexOf("<hp:tc", labEnd + 8);
    const ne = xml.indexOf("</hp:tc>", ns);
    if (ns < 0 || ne < 0) continue;
    let tc = xml.slice(ns, ne + 8);
    const m = tc.match(/<hp:run charPrIDRef="(\d+)"\/>/)
           || tc.match(/<hp:run charPrIDRef="(\d+)"><hp:t><\/hp:t><\/hp:run>/);
    if (!m) continue;
    const repl = `<hp:run charPrIDRef="${cloner.black(m[1])}"><hp:t>${xmlEsc(text)}</hp:t></hp:run>`;
    tc = tc.replace(m[0], repl);
    xml = xml.slice(0, ns) + tc + xml.slice(ne + 8);
  }
  return xml;
}

// 결과보고서 (보조강사 취합 서류) — 회차 블록 확장/삭제 + (선택)추진의견 자동삽입
export function buildReportHwpx(templateBuf, data) {
  return buildPlaceholderHwpx(templateBuf, data, expandReportRounds, fillReportOpinions);
}

// 안전관리 업무 활동 풀(30개) — 예시와 비슷한 톤/길이. 매번 랜덤 10개 사용.
const SAFETY_ACTIVITIES = [
  "교육시설 안전점검 및 교육",
  "전염병 확산 방지를 위한 발열체크 및 손소독 실시",
  "교구 및 장비 안전 점검",
  "교내 통학로 및 차량통행로 안전 확인 및 귀가 지도",
  "위급 발생 대비를 위한 학부모 비상연락망 관리",
  "비상 시 대비 점검(소화기, 비상구, 화재감지기 등)",
  "화재 및 위생 안전 점검",
  "가스, 전기, 소방시설 점검",
  "계단 미끄럼방지 및 파손 안전 점검",
  "피난 및 방화설비 안전 점검",
  "출입구 및 복도 통행로 안전 확보",
  "응급상황 대비 구급함 및 비상약품 점검",
  "교실 내 콘센트 및 멀티탭 전기 안전 점검",
  "책상·의자 등 집기류 모서리 안전 점검",
  "바닥 미끄럼 및 걸림 위험 점검",
  "창문 및 방충망 추락 방지 점검",
  "교육 중 안전사고 예방 순회 지도",
  "학생 등·하교 동선 안전 지도",
  "식음료 및 다과 위생 상태 확인",
  "알레르기·기저질환 학생 사전 파악 및 관리",
  "비상대피로 및 대피경로 사전 확인",
  "소방시설 위치 안내 및 사용법 숙지",
  "냉·난방기 작동 상태 및 환기 관리",
  "정수기 및 급수시설 위생 점검",
  "교내 위험구역 출입 통제 및 안내",
  "안전사고 발생 시 대응 절차 숙지",
  "감염병 예방 수칙 안내 및 관리",
  "교구 정리정돈 및 보관 상태 점검",
  "외부인 출입 통제 및 방문객 관리",
  "일일 안전점검 결과 기록 및 보고"
];

// 업무내용 표: charPr 27 활동 항목 run(헤더 2개 제외)을 순서대로 랜덤 10개로 교체
// (검정·11pt·함초롬바탕·정자체로 통일, '- ' 중복 없이)
function fillSafetyActivities(xml, cloner) {
  const pool = SAFETY_ACTIVITIES.slice();
  for (let i = pool.length - 1; i > 0; i--) {           // Fisher–Yates 셔플
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, 10);
  const black = cloner.black(27);
  const skip = new Set(["(안전관리 업무 활동)", "(예시를 참고하여 작성할 것)"]);
  let i = 0;
  xml = xml.replace(/<hp:run charPrIDRef="27"><hp:t>([^<]*)<\/hp:t><\/hp:run>/g, (m, t) => {
    if (skip.has(t.trim()) || i >= picked.length) return m;
    return `<hp:run charPrIDRef="${black}"><hp:t>- ${xmlEsc(picked[i++])}</hp:t></hp:run>`;
  });
  return xml;
}

// 안전업무일지 (안전관리자 서류) — 프로그램/기간/운영일시/운영기관/안전관리자 성명 채움
// + 업무내용 30개 풀에서 랜덤 10개(검정·맑은고딕 11pt)
export function buildSafetyLogHwpx(templateBuf, data) {
  return buildPlaceholderHwpx(templateBuf, data, null, fillSafetyActivities);
}

// 안전관리 서약서 (3-2) — 캠프명/일시·장소/현장안전담당(안전관리자)/서약일 채움
// 운영기관·PM 블록은 템플릿 고정값 유지. data: { program, school, safetyManager, days, year }
export async function buildSafetyPledgeHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);
  const days = (data.days || []).filter(d => d && d.date);
  const year = data.year || 2026;
  const first = days[0]?.date, last = days[days.length - 1]?.date;

  // 드롭다운 메모/옵션 비우기 후 캠프명 채우기
  xml = xml.replace(/<hp:t>해당 프로그램명 작성<\/hp:t>/g, "<hp:t></hp:t>");
  xml = xml.replace(/<hp:t>\((?:기본|특화|AI특화)\/[^<]*<\/hp:t>/g, "<hp:t></hp:t>");
  if (data.program) xml = fillFieldBlack(xml, cloner, "프로그램명 작성", data.program);

  // 일시/장소: "2026년 [ 00월 00일 ~ ] 2026년 [ 00월 00일 / 00초등학교]"
  if (first) xml = fillFieldBlack(xml, cloner, " 00월 00일 ~ ", ` ${first.m}월 ${first.d}일 ~ `);
  if (last) xml = fillFieldBlack(xml, cloner, " 00월 00일 / 00초등학교", ` ${last.m}월 ${last.d}일 / ${data.school || "00초등학교"}`);

  // 현장안전담당(안전관리자) 성명 + 서명란
  if (data.safetyManager) {
    xml = fillFieldBlack(xml, cloner, "안전관리자 성명", data.safetyManager);
    xml = fillFieldBlack(xml, cloner, "현장안전담당:   ", `현장안전담당:   ${data.safetyManager}   `);
  }
  // 서약일 = 첫 캠프일
  if (first) xml = fillFieldBlack(xml, cloner, "2026. 00. 00.", `${year}. ${pad2(first.m)}. ${pad2(first.d)}.`);

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// 프로그램 운영 사례집 (붙임2 후기 모음) — 프로그램명/운영장소/운영일시 채움
// data: { program, school, days, year, reviews:{학생,학부모,강사} }  (reviews 없으면 예시 유지)
export async function buildCaseBookHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);
  const days = (data.days || []).filter(d => d && d.date);
  const year = data.year || 2026;
  const first = days[0]?.date, last = days[days.length - 1]?.date;

  if (data.program) xml = fillFieldBlack(xml, cloner, "해당 프로그램을 복사하여 붙여 넣어주세요", data.program);
  if (data.school) xml = fillFieldBlack(xml, cloner, "교육장소를 작성해주세요", data.school);
  if (first && last) {
    const fd = days[0];
    const period = `${year}년 ${pad2(first.m)}월 ${pad2(first.d)}일 ~ ${pad2(last.m)}월 ${pad2(last.d)}일`;
    // 운영일시 자리표시자: "00시" 앞 공백 2칸
    xml = fillFieldBlack(xml, cloner, "2026년 00월 00일 ~ 00월 00일 /  00시 00분 ~ 00시 00분",
      `${period} / ${fmtTime(fd.start)} ~ ${fmtTime(fd.end)}`);
  }

  // 후기 예시(학생→학부모→강사, charPr 46 단일 run)을 AI 후기로 교체
  const reviews = data.reviews || {};
  const order = ["학생", "학부모", "강사"];
  let ri = 0;
  xml = xml.replace(/<hp:run charPrIDRef="46"><hp:t>예시\(참고\)[^<]*<\/hp:t><\/hp:run>/g, (m) => {
    const t = (reviews[order[ri++]] || "").trim();
    return t ? `<hp:run charPrIDRef="${cloner.black(46)}"><hp:t>${xmlEsc(t)}</hp:t></hp:run>` : m;
  });

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// 지급신청서 공통: 프로그램/교육장소/교육대상/산출내역/지급액 채우기
// data: { program, school, eduTarget, payoutLines:[..], amount:"540,000", slots:[..], amountSlot }
function fillPayBody(xml, cloner, data) {
  // 드롭다운 메모 비우기
  xml = xml.replace(/<hp:t>해당 프로그램명 작성<\/hp:t>/g, "<hp:t></hp:t>");
  xml = xml.replace(/<hp:t>\((?:기본|특화|AI특화)\/[^<]*<\/hp:t>/g, "<hp:t></hp:t>");

  if (data.program) xml = fillFieldBlack(xml, cloner, "해당 프로그램 복사하여 붙여넣기", data.program);
  if (data.school) xml = fillFieldBlack(xml, cloner, " 캠프가 진행되는 학교명", " " + data.school);
  if (data.eduTarget) xml = fillFieldBlack(xml, cloner, " 초등 저학년/초등 고학년/중등/고등/다문화", " " + data.eduTarget);

  // 산출내역: 템플릿 예시 슬롯 → 실제 줄, 남는 슬롯 비움
  const lines = data.payoutLines || [];
  (data.slots || []).forEach((slot, i) => {
    if (i < lines.length) xml = fillFieldBlack(xml, cloner, slot, " " + lines[i]);
    else xml = xml.replace(new RegExp(`<hp:t>${rgEsc(slot)}</hp:t>`, "g"), "<hp:t></hp:t>");
  });
  if (data.amount && data.amountSlot) xml = fillFieldBlack(xml, cloner, data.amountSlot, ` ${data.amount}원`);
  return xml;
}

// 외부 전문가 기술 활용비 지급신청서 (주강사·보조강사 공용) — 캠프 1건당 1부
// data: { program, school, eduTarget, payoutLines, amount, lastDate, slots, amountSlot, year }
export async function buildPayApplicationHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);

  const slots = data.slots || [
    " (오전) 6/21 60,000원 X 1학급 X 4차시",
    " (오후) 6/21 60,000원 X 1학급 X 4차시",
    " (오전) 6/28 60,000원 X 1학급 X 4차시"
  ];
  xml = fillPayBody(xml, cloner, { ...data, slots, amountSlot: data.amountSlot || " N00,000원" });
  if (data.lastDate) xml = xml.replace(/2026년 #월 #일/g, xmlEsc(data.lastDate));

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// (안전) 단기근로자 지급신청서 — 캠프 1건당 1부, 안전관리자 1인
// data: { program, school, eduTarget, payoutLines, amount, lastDate }
export async function buildSafetyPayHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);

  const slots = [
    " 6/21 20,000원 X 1학급 X 3or4차시",
    " 6/22 20,000원 X 1학급 X 3or4차시"
  ];
  xml = fillPayBody(xml, cloner, { ...data, slots, amountSlot: " N00,000원" });
  // 날짜 자리표시자 "2026년  월  일" (공백 2칸)
  if (data.lastDate) xml = xml.replace(/<hp:t>2026년\s+월\s+일<\/hp:t>/g, `<hp:t>${xmlEsc(data.lastDate)}</hp:t>`);

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// (안전) 일용직활용비 단기 근로계약서 — 안전관리자 1인, 캠프 1건당 1부
// data: { name, school, dateList:[{m,d,wd,amStart,amEnd,pmStart,pmEnd}], firstDate, lastDate, amount, month }
export async function buildSafetyContractHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const list = data.dateList || [];

  // 근로자 성명 / 근무장소
  if (data.name) xml = xml.replace(/<hp:t>ㅇㅇㅇ<\/hp:t>/g, `<hp:t>${xmlEsc(data.name)}</hp:t>`);
  if (data.school) xml = xml.replace(/<hp:t>ㅇㅇ학교<\/hp:t>/g, `<hp:t>${xmlEsc(data.school)}</hp:t>`);

  // 근로계약날짜: "2026년 ㅇ월 ㅇ일, 2026년 ㅇ월 ㅇ일" → 시작일, 종료일
  if (data.firstDate && data.lastDate) {
    const f = data.firstDate, l = data.lastDate;
    xml = xml.replace(/<hp:t>2026년 ㅇ월 ㅇ일, 2026년 ㅇ월 ㅇ일<\/hp:t>/g,
      `<hp:t>${xmlEsc(`2026년 ${f.m}월 ${f.d}일, 2026년 ${l.m}월 ${l.d}일`)}</hp:t>`);
  }

  // 근로일자(요일): 4개 날짜 컬럼을 실제 일자로 (없으면 비움)
  let di = 0;
  xml = xml.replace(/<hp:t>2026\/#\/#\([월화수목]\)<\/hp:t>/g, () => {
    const d = list[di++];
    return d ? `<hp:t>${xmlEsc(`2026/${d.m}/${d.d}(${d.wd})`)}</hp:t>` : "<hp:t></hp:t>";
  });
  // 총 근로시간: 오전(예시 09:00~12:10) / 오후(14:20~15:40) 각 4칸
  let ai = 0;
  xml = xml.replace(/<hp:t>\(예시\)09:00~12:10<\/hp:t>/g, () => {
    const d = list[ai++];
    return `<hp:t>${d && d.amStart ? xmlEsc(`${d.amStart}~${d.amEnd}`) : ""}</hp:t>`;
  });
  let pi = 0;
  xml = xml.replace(/<hp:t>14:20~15:40<\/hp:t>/g, () => {
    const d = list[pi++];
    return `<hp:t>${d && d.pmStart ? xmlEsc(`${d.pmStart}~${d.pmEnd}`) : ""}</hp:t>`;
  });

  // 임금(N00,000) / 계약 체결월(캠프 해당 월 1일)
  if (data.amount) xml = xml.replace(/<hp:t>N00,000<\/hp:t>/g, `<hp:t>${xmlEsc(data.amount)}</hp:t>`);
  if (data.month) xml = xml.replace(/<hp:t>2026년 월 1일<\/hp:t>/g, `<hp:t>${xmlEsc(`2026년 ${data.month}월 1일`)}</hp:t>`);

  zip.file(path, xml);
  return packageHwpx(zip);
}

// 운영 전후 안전관리 체크리스트 — 점검책임자(안전관리자)·점검일자만 채움(체크는 수기)
export async function buildChecklistHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const days = (data.days || []).filter(d => d && d.date);
  const year = data.year || 2026;
  const first = days[0]?.date, last = days[days.length - 1]?.date;
  const fmt = o => o ? `${year}년 ${o.m}월 ${o.d}일` : null;
  const nm = data.safetyManager || "";

  // 점검책임자 이름 (모든 "점검책임자 :   서명" 패턴, 뒤 공백/서명 보존)
  if (nm) {
    xml = xml.replace(/(점검책임자\s*:\s*)( {2,})(서명)/g, (m, a, sp, c) => `${a}${xmlEsc(nm)}${sp}${c}`);
  }
  // 운영 전 점검일자 = 시작일
  if (first) xml = xml.replace(/점검일자:\s*2026년\s+월\s+일/, `점검일자: ${fmt(first)}`);
  // 운영 후 날짜(단독 노드 "2026년 월 일") = 마지막일
  if (last) xml = xml.replace(/<hp:t>2026년 월 일<\/hp:t>/, `<hp:t>${xmlEsc(fmt(last))}</hp:t>`);

  zip.file(path, xml);
  return packageHwpx(zip);
}

// 다문화학생 학교장 확인서 — 클래스별, 다문화 학생 명단·학교명·인원·날짜 채움
// data: { school, names:[..], count, date:"2026년 6월 9일" }
export async function buildMulticulturalConfirmHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const names = data.names || [];

  // 이름 표: col1/col4/col8 × row5~14 (각 10명, 총 30명) 빈 run에 주입
  xml = xml.replace(/<hp:tc\b[\s\S]*?<\/hp:tc>/g, (tc) => {
    const a = tc.match(/colAddr="(\d+)" rowAddr="(\d+)"/);
    if (!a) return tc;
    const col = +a[1], row = +a[2];
    let idx = -1;
    if (row >= 5 && row <= 14) {
      if (col === 1) idx = row - 5;
      else if (col === 4) idx = row - 5 + 10;
      else if (col === 8) idx = row - 5 + 20;
    }
    if (idx >= 0 && idx < names.length && names[idx]) {
      return tc.replace(/<hp:run charPrIDRef="(\d+)"\/>/,
        `<hp:run charPrIDRef="$1"><hp:t>${xmlEsc(names[idx])}</hp:t></hp:run>`);
    }
    return tc;
  });

  // 학교명(값 셀) + 직인줄 "초등학교장 (직인)"
  if (data.school) {
    xml = xml.replace(/<hp:t>초등학교<\/hp:t>/g, `<hp:t>${xmlEsc(data.school)}</hp:t>`);
    const base = data.school.replace(/초등학교$/, "");
    xml = xml.replace(/<hp:t>초등학교장 \(직인\)<\/hp:t>/g, `<hp:t>${xmlEsc(base)}초등학교장 (직인)</hp:t>`);
  }
  // 확인 인원
  if (data.count != null) {
    xml = xml.replace("<hp:t>위 학생들이 본교에 재학중인 다문화가정 학생(      학생)임을 확인합니다.</hp:t>",
      `<hp:t>위 학생들이 본교에 재학중인 다문화가정 학생(총 ${data.count}명)임을 확인합니다.</hp:t>`);
  }
  // 확인 날짜
  if (data.date) xml = xml.replace(/<hp:t>2026년\s+월\s+일<\/hp:t>/g, `<hp:t>${xmlEsc(data.date)}</hp:t>`);

  zip.file(path, xml);
  return packageHwpx(zip);
}
