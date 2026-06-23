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

  // 수령대장 파란 글씨(일차 헤더·안내문 등)를 모두 검정으로
  header.xml = header.xml.replace(/(<hh:charPr\b[^>]*\btextColor=")#0000FF(")/gi, "$1#000000$2");

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// ---------- hwpx(OCF) 패키징 (한글 호환) ----------
// mimetype은 STORE(무압축)·첫 엔트리 유지, 나머지는 DEFLATE.
// JSZip이 자동 추가하는 폴더 엔트리(Contents/ 등)는 원본에 없으므로 제거.
async function packageHwpx(zip) {
  // 빈 기본 한글 스크립트(Scripts/*.js) 제거 → "스크립트 포함 문서" 보안경고 해소.
  // content.hpf의 item·spine itemref 참조도 함께 제거(없는 파일 참조 시 오류 방지).
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

// 서식은 원본 그대로 두고 텍스트만 치환하는 정책 → 모든 메서드는 원본 id를 그대로 반환(no-op).
// (이전엔 검정·11pt·함초롬 강제 통일을 했으나, 양식과 충돌하여 폰트 꼬임이 생겨 비활성화)
function makeBlackCloner(header) {
  const cache = {};
  return {
    get xml() { return header.xml; },
    black(cid) { return cid; },
    colorBlack(cid) { return cid; },
    // 글자 크기만 변경(색·폰트 유지). 의견·후기 칸 11pt(1100)용
    resize(cid, h = 1100) {
      const key = "r" + cid + "_" + h;
      if (cache[key] != null) return cache[key];
      const m = header.xml.match(new RegExp(`<hh:charPr id="${cid}"[\\s\\S]*?</hh:charPr>`));
      if (!m) return cid;
      const block = m[0];
      if (new RegExp(`\\bheight="${h}"`).test(block)) { cache[key] = cid; return cid; }
      const maxId = Math.max(...[...header.xml.matchAll(/<hh:charPr id="(\d+)"/g)].map(x => +x[1]));
      const newId = maxId + 1;
      let clone = block.replace(`id="${cid}"`, `id="${newId}"`);
      clone = /\bheight="\d+"/.test(clone) ? clone.replace(/\bheight="\d+"/, `height="${h}"`)
                                           : clone.replace(/(<hh:charPr id="\d+")/, `$1 height="${h}"`);
      header.xml = header.xml.replace(block, block + clone)
        .replace(/(<hh:charProperties itemCnt=")(\d+)(")/, (mm, a, n, b) => a + (+n + 1) + b);
      cache[key] = newId;
      return newId;
    },
    // 결과보고서 추진의견 칸용: 왼쪽정렬 + 줄간격 160% paraPr 복제(다른 서류 미사용)
    leftPara(srcId) {
      const key = "p" + srcId;
      if (cache[key] != null) return cache[key];
      const m = header.xml.match(new RegExp(`<hh:paraPr id="${srcId}"[\\s\\S]*?</hh:paraPr>`));
      if (!m) return srcId;
      const pmax = Math.max(...[...header.xml.matchAll(/<hh:paraPr id="(\d+)"/g)].map(x => +x[1]));
      const newId = pmax + 1;
      const clone = m[0].replace(`id="${srcId}"`, `id="${newId}"`)
        .replace(/<hh:align\b[^>]*\/>/, '<hh:align horizontal="LEFT" vertical="BASELINE"/>')
        .replace(/<hh:lineSpacing type="[^"]*" value="\d+" unit="([^"]*)"\/>/g, '<hh:lineSpacing type="PERCENT" value="160" unit="$1"/>')
        .replace(/<hc:intent value="-?\d+" unit="([^"]*)"\/>/g, '<hc:intent value="0" unit="$1"/>');
      header.xml = header.xml.replace(m[0], m[0] + clone)
        .replace(/(<hh:paraProperties itemCnt=")(\d+)(")/, (mm, a, n, b) => a + (+n + 1) + b);
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

// 교구관리대장 부제목 18pt 보정 (양식 원본 16pt → 18pt). 텍스트 노드 보존(앞뒤 공백 유지)
function fillEquipTitles(xml, cloner) {
  for (const title of ["2026 디지털새싹 사업", "범용성 및 일회성 교구 관리 대장"]) {
    xml = xml.replace(new RegExp(`<hp:run charPrIDRef="(\\d+)">(<hp:t>${rgEsc(title)}[^<]*</hp:t>)</hp:run>`, "g"),
      (m, cid, inner) => `<hp:run charPrIDRef="${cloner.resize(cid, 1800)}">${inner}</hp:run>`);
  }
  return xml;
}

// ===== 사용자 완성본(마스터) 기준 치환 유틸 =====
// 마스터엔 자리표시자 대신 실제값(증안초/권준구/노벨엔지니어링/06.20~21/8차시)이 박혀 있어,
// 그 값을 새 입력으로 문자열 치환한다. 서식(charPr/paraPr)은 완성본 그대로 보존.
const M = {  // 마스터에 박힌 기준값
  program: "(기본/초저) 노벨엔지니어링으로 만드는 안전한 등굣길",
  school: "증안초등학교",
  org: "대림대학교",
  main: "권준구", assist: "원종민", safety: "이소정",
  qty: "25",
  d1: { m: 6, d: 20 }, d2: { m: 6, d: 21 },
  amStart: "09:00", amEnd: "12:10", pmStart: "13:00", pmEnd: "16:10"
};
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function replaceAllText(xml, find, repl) {
  if (find == null || find === "" || repl == null) return xml;
  return xml.split(find).join(repl);
}
// {m,d}에서 delta일 이동(월 경계 자동 처리). 연도 2026 고정.
function shiftDate(o, delta) {
  const dt = new Date(2026, o.m - 1, o.d + delta);
  return { m: dt.getMonth() + 1, d: dt.getDate() };
}
// 이름 익명화: 가운데 글자를 O로 (3자 "홍길동"→"홍O동", 4자 "남궁민수"→"남OO수", 2자 "김수"→"김O")
function anonName(name) {
  const n = (name || "").trim();
  if (n.length >= 3) return n[0] + "O".repeat(n.length - 2) + n[n.length - 1];
  if (n.length === 2) return n[0] + "O";
  return n;
}
const pickRandom = (arr) => (arr && arr.length) ? arr[Math.floor(Math.random() * arr.length)] : "";
const _SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권", "황", "안", "송", "홍", "전"];
const _GIVEN = ["민준", "서연", "도윤", "하은", "지호", "수아", "예준", "지우", "주원", "서윤", "건우", "채원", "현우", "유진", "지훈", "소율", "준서", "다은", "시우", "예린"];
function randKoreanName() {
  return _SURNAMES[Math.floor(Math.random() * _SURNAMES.length)] + _GIVEN[Math.floor(Math.random() * _GIVEN.length)];
}
// 마스터의 일차 단락(2일치)을 days 개수에 맞게 복제/삭제하고 날짜·시간 채움
function fillMasterDays(xml, days) {
  const period = `2026년 ${pad2(days[0].date.m)}월 ${pad2(days[0].date.d)}일 ~ ${pad2(days[days.length-1].date.m)}월 ${pad2(days[days.length-1].date.d)}일`;
  // 연속된 (N일차) 단락 묶음을 days로 재생성
  xml = xml.replace(/(?:<hp:p\b[^>]*>(?:(?!<\/hp:p>)[\s\S])*?<hp:t>\(\d일차\)[^<]*<\/hp:t>(?:(?!<\/hp:p>)[\s\S])*?<\/hp:p>)+/g, (block) => {
    const one = block.match(/<hp:p\b[^>]*>(?:(?!<\/hp:p>)[\s\S])*?<\/hp:p>/)[0]
      .replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/, "");   // 줄정보 제거(한글 재계산)
    return days.map((d, i) =>
      one.replace(/<hp:t>\(\d일차\)[^<]*<\/hp:t>/,
        `<hp:t>(${i + 1}일차) ${pad2(d.date.m)}월 ${pad2(d.date.d)}일 / ${fmtTime(d.start)} ~ ${fmtTime(d.end)}</hp:t>`)
    ).join("");
  });
  // 기간 문자열(2026년 06월 20일 ~ 06월 21일 [/ 시간])
  xml = xml.replace(new RegExp(`2026년 ${pad2(M.d1.m)}월 ${pad2(M.d1.d)}일 ~ ${pad2(M.d2.m)}월 ${pad2(M.d2.d)}일`, "g"), period);
  return xml;
}

// 공통 마스터 치환: 일차·기간·각종 날짜형식 + 프로그램/학교/기관/담당자/교구수량
function applyMaster(xml, data) {
  const days = (data.days || []).filter(d => d && d.date);
  if (days.length) {
    xml = fillMasterDays(xml, days);                 // 일차 단락 + "2026년 06월 20일 ~ 06월 21일"(pad)
    const f = days[0].date, l = days[days.length - 1].date;
    // 서약서형 "2026년 6월 20일 ~ 2026년 6월 21일" (2026년 2회·pad 없음) — 단독 nopad보다 먼저
    xml = replaceAllText(xml, `2026년 ${M.d1.m}월 ${M.d1.d}일 ~ 2026년 ${M.d2.m}월 ${M.d2.d}일`,
      `2026년 ${f.m}월 ${f.d}일 ~ 2026년 ${l.m}월 ${l.d}일`);
    // dot 형식 "2026. 06. 20." / "2026. 06. 21."
    xml = replaceAllText(xml, `2026. ${pad2(M.d1.m)}. ${pad2(M.d1.d)}.`, `2026. ${pad2(f.m)}. ${pad2(f.d)}.`);
    xml = replaceAllText(xml, `2026. ${pad2(M.d2.m)}. ${pad2(M.d2.d)}.`, `2026. ${pad2(l.m)}. ${pad2(l.d)}.`);
    // 수령일시 "2026.06.20"
    xml = replaceAllText(xml, `2026.${pad2(M.d1.m)}.${pad2(M.d1.d)}`, `2026.${pad2(f.m)}.${pad2(f.d)}`);
    // 단독 nopad "2026년 6월 21일"(지급·체크리스트 종료일), "2026년 6월 20일"(시작일)
    xml = replaceAllText(xml, `2026년 ${M.d2.m}월 ${M.d2.d}일`, `2026년 ${l.m}월 ${l.d}일`);
    xml = replaceAllText(xml, `2026년 ${M.d1.m}월 ${M.d1.d}일`, `2026년 ${f.m}월 ${f.d}일`);
  }
  if (data.program) xml = replaceAllText(xml, M.program, data.program);
  if (data.school) xml = replaceAllText(xml, M.school, data.school);
  if (data.org) xml = replaceAllText(xml, M.org, data.org);
  if (data.mainTeacher) xml = replaceAllText(xml, M.main, data.mainTeacher);
  if (data.assistantTeacher) xml = replaceAllText(xml, M.assist, data.assistantTeacher);
  if (data.safetyManager) xml = replaceAllText(xml, M.safety, data.safetyManager);
  if (data.equipQty) xml = replaceAllText(xml, `${M.qty}개`, `${data.equipQty}개`);
  return xml;
}
// 공통: 마스터 hwpx 로드→applyMaster→(extra)→저장
async function buildFromMaster(templateBuf, data, extra) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  xml = applyMaster(xml, data);
  if (extra) xml = extra(xml, data);
  zip.file(path, xml);
  return packageHwpx(zip);
}

// 교구 관리대장 — 사용자 완성본(마스터) 기준 치환
// 박힌값: 프로그램/증안초/대림대학교/권준구/25개/06.20~21, 수령일시(시작일)·제출일(마지막일)
// data: { program, school, org, mainTeacher, equipQty, days:[{date,start,end}], year }
export async function buildEquipmentLedgerHwpx(templateBuf, data) {
  return buildFromMaster(templateBuf, data);   // applyMaster가 일차·기간·수령일시·제출일·담당자·교구수량 처리
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
    // 단락을 왼쪽정렬·줄간격160으로 + 빈칸용 줄정보 제거(긴 텍스트 자동 줄바꿈)
    const pp = tc.match(/paraPrIDRef="(\d+)"/);
    if (pp) tc = tc.replace(/paraPrIDRef="\d+"/, `paraPrIDRef="${cloner.leftPara(pp[1])}"`);
    tc = tc.replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/, "");
    const m = tc.match(/<hp:run charPrIDRef="(\d+)"\/>/)
           || tc.match(/<hp:run charPrIDRef="(\d+)"><hp:t><\/hp:t><\/hp:run>/);
    if (!m) continue;
    const repl = `<hp:run charPrIDRef="${cloner.resize(m[1], 1100)}"><hp:t>${xmlEsc(text)}</hp:t></hp:run>`;
    tc = tc.replace(m[0], repl);
    xml = xml.slice(0, ns) + tc + xml.slice(ne + 8);
  }
  return xml;
}

// ── 결과보고서: 사용자 완성본(마스터) 기준 치환 ──
// 완성본 회차2 블록(「디지털새싹」 프로그램 2회차 ~ "3. 기타 운영사항" 직전)을 일수에 맞게 복제/삭제
function expandMasterReportRounds(xml, days) {
  const D = days.length;
  if (D === 2) return xml;
  const r2 = xml.indexOf("2회차");
  if (r2 < 0) return xml;
  const h2 = xml.lastIndexOf("「디지털새싹」 프로그램", r2);
  const b2 = xml.lastIndexOf("<hp:p ", h2);
  const g = xml.indexOf("3. 기타 운영사항");
  const gs = xml.lastIndexOf("<hp:p ", g);
  if (b2 < 0 || gs < 0 || b2 >= gs) return xml;
  const block2 = xml.slice(b2, gs);
  if (D < 2) return xml.slice(0, b2) + xml.slice(gs);   // 1일: 회차2 삭제
  // 3일 이상: 회차2 블록 복제(3..D), 회차번호·일차 날짜 갱신, id 재부여
  let maxId = Math.max(...[...xml.matchAll(/\bid="(\d{6,})"/g)].map(x => +x[1]), 0);
  let clones = "";
  for (let k = 3; k <= D; k++) {
    const d = days[k - 1];
    clones += block2
      .replace(/<hp:t>2회차<\/hp:t>/, `<hp:t>${k}회차</hp:t>`)
      .replace(/<hp:t>\(2일차\)[^<]*<\/hp:t>/, `<hp:t>(${k}일차) ${pad2(d.date.m)}월 ${pad2(d.date.d)}일 / ${fmtTime(d.start)} ~ ${fmtTime(d.end)}</hp:t>`)
      .replace(/\bid="(\d{6,})"/g, () => `id="${++maxId}"`);
  }
  return xml.slice(0, gs) + clones + xml.slice(gs);
}
// 추진의견(주/보조/안전): 라벨 다음 단락의 charPr33 의견 텍스트를 새 의견으로 교체
function fillMasterOpinions(xml, opinions) {
  const labels = { "주강사": "(주강사 작성용)", "보조강사": "(보조강사 작성용)", "안전관리자": "(안전관리자 작성용)" };
  for (const role of Object.keys(labels)) {
    const t = (opinions[role] || "").trim();
    if (!t) continue;
    const i = xml.indexOf(labels[role]);
    if (i < 0) continue;
    const le = xml.indexOf("</hp:p>", i);
    const ns = xml.indexOf("<hp:p ", le);
    const ne = xml.indexOf("</hp:p>", ns) + 7;
    if (ns < 0 || ne < 7) continue;
    let para = xml.slice(ns, ne);
    let done = false;
    para = para.replace(/<hp:run charPrIDRef="33"><hp:t>[^<]*<\/hp:t><\/hp:run>/g, (m) => {
      if (!done) { done = true; return `<hp:run charPrIDRef="33"><hp:t>${xmlEsc(t)}</hp:t></hp:run>`; }
      return "";   // 같은 단락의 추가 의견 run 제거
    });
    if (done) xml = xml.slice(0, ns) + para + xml.slice(ne);
  }
  return xml;
}
// 결과보고서 — 완성본 마스터 기준: 회차 복제 + program/school/org/보조강사·확인자 + 날짜 + 추진의견
export async function buildReportHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const days = (data.days || []).filter(d => d && d.date);

  if (days.length) {
    xml = expandMasterReportRounds(xml, days);
    const f = days[0].date, l = days[days.length - 1].date;
    const period = `2026년 ${pad2(f.m)}월 ${pad2(f.d)}일 ~ ${pad2(l.m)}월 ${pad2(l.d)}일`;
    const t0 = `${fmtTime(days[0].start)} ~ ${fmtTime(days[0].end)}`;
    // 운영기간(시간 포함 먼저) → 기간 → 본문/수령대장 일차(1·2)
    xml = replaceAllText(xml, `2026년 ${pad2(M.d1.m)}월 ${pad2(M.d1.d)}일 ~ ${pad2(M.d2.m)}월 ${pad2(M.d2.d)}일 / ${fmtTime(M.amStart)} ~ ${fmtTime(M.amEnd)}`, `${period} / ${t0}`);
    xml = replaceAllText(xml, `2026년 ${pad2(M.d1.m)}월 ${pad2(M.d1.d)}일 ~ ${pad2(M.d2.m)}월 ${pad2(M.d2.d)}일`, period);
    xml = replaceAllText(xml, `(1일차) ${pad2(M.d1.m)}월 ${pad2(M.d1.d)}일 / ${fmtTime(M.amStart)} ~ ${fmtTime(M.amEnd)}`,
      `(1일차) ${pad2(f.m)}월 ${pad2(f.d)}일 / ${t0}`);
    if (days[1]) {
      const d2 = days[1];
      xml = replaceAllText(xml, `(2일차) ${pad2(M.d2.m)}월 ${pad2(M.d2.d)}일 / ${fmtTime(M.amStart)} ~ ${fmtTime(M.amEnd)}`,
        `(2일차) ${pad2(d2.date.m)}월 ${pad2(d2.date.d)}일 / ${fmtTime(d2.start)} ~ ${fmtTime(d2.end)}`);
    }
  }
  if (data.program) xml = replaceAllText(xml, M.program, data.program);
  if (data.school) xml = replaceAllText(xml, M.school, data.school);
  if (data.org) xml = replaceAllText(xml, M.org, data.org);
  if (data.assistantTeacher) xml = replaceAllText(xml, M.assist, data.assistantTeacher);  // 확인자(수령대장)
  if (data.opinions) xml = fillMasterOpinions(xml, data.opinions);

  zip.file(path, xml);
  return packageHwpx(zip);
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
  const drop = new Set(["(안전관리 업무 활동)", "(예시를 참고하여 작성할 것)"]);
  let i = 0;
  xml = xml.replace(/<hp:run charPrIDRef="27"><hp:t>([^<]*)<\/hp:t><\/hp:run>/g, (m, t) => {
    const tt = t.trim();
    if (drop.has(tt)) return `<hp:run charPrIDRef="${black}"><hp:t></hp:t></hp:run>`;  // 헤더 2줄 삭제
    if (i >= picked.length) return m;
    const item = picked[i++].replace(/^[-\s]+/, "");   // 앞 '- ' 중복 방지(하나만)
    return `<hp:run charPrIDRef="${black}"><hp:t>- ${xmlEsc(item)}</hp:t></hp:run>`;
  });
  return xml;
}

// 안전업무일지 — 사용자 완성본(마스터) 기준. 활동은 30개 풀에서 매번 랜덤 10개로 교체
// 완성본 활동 run은 charPr 28(검정·정자체). 풀에 있는 텍스트인 run만 순서대로 교체
function fillSafetyActivitiesMaster(xml) {
  const pool = SAFETY_ACTIVITIES.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const picked = pool.slice(0, 10);
  const set = new Set(SAFETY_ACTIVITIES);
  let i = 0;
  return xml.replace(/<hp:run charPrIDRef="28"><hp:t>([^<]*)<\/hp:t><\/hp:run>/g, (m, t) => {
    if (set.has(t.trim()) && i < picked.length)
      return `<hp:run charPrIDRef="28"><hp:t>${xmlEsc(picked[i++])}</hp:t></hp:run>`;
    return m;
  });
}
// 안전업무일지 — 프로그램/기간/운영일시/운영기관/안전관리자(이소정) + 활동 랜덤 10개
export function buildSafetyLogHwpx(templateBuf, data) {
  return buildFromMaster(templateBuf, data, (xml) => fillSafetyActivitiesMaster(xml));
}

// 안전관리 서약서 (3-2) — 사용자 완성본(마스터) 기준
// 박힌값: 캠프명(program)/일시·장소("2026년 6월 20일 ~ 2026년 6월 21일 / 증안초등학교")
//        /현장안전담당(이소정 2곳)/서약일("2026. 06. 20.")
// 운영기관 산학협력단·PM 이양창·안전관리자 최지수는 고정 유지(치환 안 함)
// 서약일은 시작일 전 2일로 자동 설정(운영 전 서약).
export async function buildSafetyPledgeHwpx(templateBuf, data) {
  const days = (data.days || []).filter(d => d && d.date);
  return buildFromMaster(templateBuf, data, (xml) => {
    if (!days.length) return xml;
    const f = days[0].date;            // applyMaster가 이미 6/20→시작일(f)로 치환함
    const chk = shiftDate(f, -2);      // 서약일 = 시작일 - 2일
    // 서약일(점 형식 "2026. MM. DD.")만 시작-2일로. 일시·장소의 기간(년월일 범위)은 그대로 유지.
    return replaceAllText(xml, `2026. ${pad2(f.m)}. ${pad2(f.d)}.`, `2026. ${pad2(chk.m)}. ${pad2(chk.d)}.`);
  });
}

// 프로그램 운영 사례집 — 사용자 완성본(마스터) 기준
// 박힌값: program/운영장소(증안초)/운영일시(기간+시간)/후기 3개(charPr 47, 이미 AI작성)
// data: { program, school, days, year, reviews:{학생,학부모,강사} }  (reviews 없으면 완성본 후기 유지)
export async function buildCaseBookHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const days = (data.days || []).filter(d => d && d.date);
  const d0 = days[0];

  if (data.program) xml = replaceAllText(xml, M.program, data.program);
  if (data.school) xml = replaceAllText(xml, M.school, data.school);
  if (days.length) {
    const f = days[0].date, l = days[days.length - 1].date;
    // 운영일시: "2026년 06월 20일 ~ 06월 21일 / 09시 00분 ~ 12시 10분"
    xml = replaceAllText(xml, `2026년 ${pad2(M.d1.m)}월 ${pad2(M.d1.d)}일 ~ ${pad2(M.d2.m)}월 ${pad2(M.d2.d)}일`,
      `2026년 ${pad2(f.m)}월 ${pad2(f.d)}일 ~ ${pad2(l.m)}월 ${pad2(l.d)}일`);
    if (d0) xml = replaceAllText(xml, `${fmtTime(M.amStart)} ~ ${fmtTime(M.amEnd)}`, `${fmtTime(d0.start)} ~ ${fmtTime(d0.end)}`);
  }

  // 이름 처리: 학생=명단 랜덤1명, 학부모=랜덤생성, 강사=보조강사(모두 가운데 글자 익명)
  const student = anonName(pickRandom(data.studentNames) || randKoreanName());
  const parent = anonName(randKoreanName());
  const teacher = anonName(data.teacher || randKoreanName());
  xml = replaceAllText(xml, "학생 신O현, 학부모 최O수, 강사 김O정",
    `학생 ${student}, 학부모 ${parent}, 강사 ${teacher}`);
  xml = replaceAllText(xml, "신O현", student);
  xml = replaceAllText(xml, "최O수", parent);
  xml = replaceAllText(xml, "김O정", teacher);

  // 후기 3개(charPr 47, 학생→학부모→강사 순)를 새 AI 후기로 교체
  const reviews = data.reviews || {};
  const order = ["학생", "학부모", "강사"];
  let ri = 0;
  xml = xml.replace(/<hp:run charPrIDRef="47"><hp:t>[^<]*<\/hp:t><\/hp:run>/g, (m) => {
    const t = (reviews[order[ri++]] || "").trim();
    return t ? `<hp:run charPrIDRef="47"><hp:t>${xmlEsc(t)}</hp:t></hp:run>` : m;
  });

  zip.file(path, xml);
  return packageHwpx(zip);
}

// 지급신청서 공통: 프로그램/교육장소/교육대상/산출내역/지급액 채우기
// data: { program, school, eduTarget, payoutLines:[..], amount:"540,000", slots:[..], amountSlot }
function fillPayBody(xml, cloner, data) {
  // 드롭다운 메모 비우기
  xml = xml.replace(/<hp:t>해당 프로그램명 작성<\/hp:t>/g, "<hp:t></hp:t>");
  xml = xml.replace(/<hp:t>\((?:기본|특화|AI특화)\/[^<]*<\/hp:t>/g, "<hp:t></hp:t>");

  if (data.program) {
    // "해당 프로그램 복사하여 붙여넣기" 뒤에 필드컨트롤(<hp:ctrl>)이 붙어 run이 안 닫힘 →
    // run 여는 부분만 매칭해 charPr 검정 + 텍스트 교체(뒤 ctrl 보존)
    let done = false;
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>해당 프로그램 복사하여 붙여넣기<\/hp:t>/g,
      (m, cid) => { done = true; return `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(data.program)}</hp:t>`; });
    if (!done) xml = fillFieldBlack(xml, cloner, "해당 프로그램 복사하여 붙여넣기", data.program);
  }
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

// 외부 전문가 기술 활용비 지급신청서
//  · 주강사료: 사용자 완성본(마스터) 기준 — 박힌값(노벨/증안/초등 저학년/산출 75,000·8차시/금액 1,200,000/날짜) 치환
//  · 보조강사료: 완성본 미제공 → 기존 자리표시자 양식 유지
// data: { program, school, eduTarget, payoutLines, amount, lastDate, slots, amountSlot, year }
const JUPAY_SLOTS = [" (오전) 6/21 75,000원 X 1학급 X 8차시", " (오후) 6/21 75,000원 X 1학급 X 8차시"];
const JUPAY_AMT = " 1,200,000원";
const ASSIST_SLOTS = [" (오전) 6/20~21 45,000원 X 4차시 X 2회", " (오후) 6/20~21 45,000원 X 4차시 X 2회"];
const ASSIST_AMT = " 720,000원";
const ASSIST_EDU = " 초등 저학년/초등 고학년/중등/고등/다문화";
export async function buildPayApplicationHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");

  if (xml.includes(M.program) && xml.includes("■ 보조강사")) {
    // ── 보조강사료 완성본 마스터 ── 산출 "45,000원 X N차시 X N회", 금액 720,000, 성명 원종민
    if (data.program) xml = replaceAllText(xml, M.program, data.program);
    if (data.school) {                          // 완성본은 학교를 자리표시자로 비워둠
      xml = replaceAllText(xml, M.school, data.school);
      xml = replaceAllText(xml, " 캠프가 진행되는 학교명", " " + data.school);
    }
    if (data.eduTarget) xml = replaceAllText(xml, ASSIST_EDU, " " + data.eduTarget);
    if (data.assistantTeacher) xml = replaceAllText(xml, M.assist, data.assistantTeacher);
    const lines = data.payoutLines || [];
    ASSIST_SLOTS.forEach((slot, i) => {
      xml = (i < lines.length) ? replaceAllText(xml, slot, " " + lines[i]) : replaceAllText(xml, slot, "");
    });
    if (data.amount) xml = replaceAllText(xml, ASSIST_AMT, " " + data.amount + "원");
    if (data.lastDate) xml = replaceAllText(xml, `2026년 ${M.d2.m}월 ${M.d2.d}일`, data.lastDate);
    zip.file(path, xml);
    return packageHwpx(zip);
  }

  if (xml.includes(M.program)) {
    // ── 주강사료 완성본 마스터 ──
    if (data.program) xml = replaceAllText(xml, M.program, data.program);
    if (data.school) xml = replaceAllText(xml, M.school, data.school);
    if (data.eduTarget) xml = replaceAllText(xml, " 초등 저학년", " " + data.eduTarget);
    const lines = data.payoutLines || [];
    JUPAY_SLOTS.forEach((slot, i) => {
      xml = (i < lines.length) ? replaceAllText(xml, slot, " " + lines[i])
                               : replaceAllText(xml, slot, "");
    });
    if (data.amount) xml = replaceAllText(xml, JUPAY_AMT, " " + data.amount + "원");
    if (data.lastDate) xml = replaceAllText(xml, `2026년 ${M.d2.m}월 ${M.d2.d}일`, data.lastDate);
    zip.file(path, xml);
    return packageHwpx(zip);
  }

  // ── 보조강사료 기존 양식(자리표시자) ──
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);
  const slots = data.slots || [
    " (오전) 6/21 60,000원 X 1학급 X 4차시",
    " (오후) 6/21 60,000원 X 1학급 X 4차시",
    " (오전) 6/28 60,000원 X 1학급 X 4차시"
  ];
  xml = fillPayBody(xml, cloner, { ...data, slots, amountSlot: data.amountSlot || " N00,000원" });
  if (data.lastDate) {
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>2026년 #월 #일<\/hp:t>/g,
      (m, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(data.lastDate)}</hp:t>`);
    xml = xml.replace(/2026년 #월 #일/g, xmlEsc(data.lastDate));
  }
  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// (안전) 단기근로자 지급신청서 — 사용자 완성본(마스터) 기준
// 박힌값: 노벨/증안/초등 저학년/산출("20,000원 X 1학급 X 4차시"·"(1일 한도 60,000원)")/금액 240,000/날짜
// data: { program, school, eduTarget, payoutLines, amount, lastDate }
export async function buildSafetyPayHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");

  if (data.program) xml = replaceAllText(xml, M.program, data.program);
  if (data.school) xml = replaceAllText(xml, M.school, data.school);
  if (data.eduTarget) xml = replaceAllText(xml, " 초등 저학년", " " + data.eduTarget);
  // 일별차시: payoutLines의 "X 1학급 X N차시"에서 추출 → 완성본 "20,000원 X 1학급 X 4차시" 갱신
  const lines = data.payoutLines || [];
  const cm = (lines[0] || "").match(/X 1학급 X ([\d.]+)차시/);
  if (cm && cm[1] !== "4") xml = replaceAllText(xml, "20,000원 X 1학급 X 4차시", `20,000원 X 1학급 X ${cm[1]}차시`);
  if (data.amount) xml = replaceAllText(xml, " 240,000원", " " + data.amount + "원");
  if (data.lastDate) xml = replaceAllText(xml, `2026년 ${M.d2.m}월 ${M.d2.d}일`, data.lastDate);

  zip.file(path, xml);
  return packageHwpx(zip);
}

// (안전) 일용직활용비 단기 근로계약서 — 안전관리자 1인, 캠프 1건당 1부
// data: { name, school, dateList:[{m,d,wd,amStart,amEnd,pmStart,pmEnd}], firstDate, lastDate, amount, month }
export async function buildSafetyContractHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);
  const list = data.dateList || [];
  // 텍스트가 X인 run을 검정·함초롬·11pt로 교체하는 헬퍼
  const repl = (old, makeText) => {
    xml = xml.replace(new RegExp(`<hp:run charPrIDRef="(\\d+)"><hp:t>${old}</hp:t></hp:run>`, "g"),
      (m, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${makeText()}</hp:t></hp:run>`);
  };

  if (data.name) repl("ㅇㅇㅇ", () => xmlEsc(data.name));
  if (data.school) repl("ㅇㅇ학교", () => xmlEsc(data.school));
  if (data.firstDate && data.lastDate) {
    const f = data.firstDate, l = data.lastDate;
    repl("2026년 ㅇ월 ㅇ일, 2026년 ㅇ월 ㅇ일", () => xmlEsc(`2026년 ${f.m}월 ${f.d}일, 2026년 ${l.m}월 ${l.d}일`));
  }
  // 근로일자(요일): 4개 날짜 컬럼
  let di = 0;
  repl("2026/#/#\\([월화수목]\\)", () => { const d = list[di++]; return d ? xmlEsc(`2026/${d.m}/${d.d}(${d.wd})`) : ""; });
  // 총 근로시간: 오전 / 오후 각 4칸
  let ai = 0;
  repl("\\(예시\\)09:00~12:10", () => { const d = list[ai++]; return d && d.amStart ? xmlEsc(`${d.amStart}~${d.amEnd}`) : ""; });
  let pi = 0;
  repl("14:20~15:40", () => { const d = list[pi++]; return d && d.pmStart ? xmlEsc(`${d.pmStart}~${d.pmEnd}`) : ""; });
  // 임금 / 계약 체결월
  if (data.amount) repl("N00,000", () => xmlEsc(data.amount));
  if (data.month) repl("2026년 월 1일", () => xmlEsc(`2026년 ${data.month}월 1일`));

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}

// 운영 전후 안전관리 체크리스트 — 사용자 완성본(마스터) 기준
// 박힌값: "점검일자: 2026년 6월 20일 ... 이소정"(운영전 시작일), "날짜: 2026년 6월 21일 ... 이소정"(운영후 종료일)
// 운영 전 점검일자는 시작일 전 2일로 자동 설정. 운영 후(종료일) 점검일은 그대로 유지.
export async function buildChecklistHwpx(templateBuf, data) {
  const days = (data.days || []).filter(d => d && d.date);
  return buildFromMaster(templateBuf, data, (xml) => {   // safety(이소정)·날짜(시작/종료) 치환
    if (!days.length) return xml;
    const f = days[0].date;            // applyMaster가 이미 6/20→시작일(f)로 치환함
    const chk = shiftDate(f, -2);      // 운영 전 점검일자 = 시작일 - 2일
    // 운영 전 점검일자(=시작일 문자열)만 시작-2일로. 운영 후 날짜(종료일)는 건드리지 않음.
    return replaceAllText(xml, `2026년 ${f.m}월 ${f.d}일`, `2026년 ${chk.m}월 ${chk.d}일`);
  });
}

// 다문화학생 학교장 확인서 — 클래스별, 다문화 학생 명단·학교명·인원·날짜 채움
// data: { school, names:[..], count, date:"2026년 6월 9일" }
export async function buildMulticulturalConfirmHwpx(templateBuf, data) {
  const zip = await JSZip.loadAsync(templateBuf);
  const path = "Contents/section0.xml";
  let xml = await zip.file(path).async("string");
  const header = { xml: await zip.file("Contents/header.xml").async("string") };
  const cloner = makeBlackCloner(header);
  const names = data.names || [];

  // 이름 표: col1/col4/col8 × row5~14 (각 10명, 총 30명) 빈 run에 주입(검정·함초롬11)
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
        (m, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(names[idx])}</hp:t></hp:run>`);
    }
    return tc;
  });

  // 학교명(값 셀) + 직인줄 "초등학교장 (직인)"
  if (data.school) {
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>초등학교<\/hp:t><\/hp:run>/g,
      (m, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(data.school)}</hp:t></hp:run>`);
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
  if (data.date) {
    xml = xml.replace(/<hp:run charPrIDRef="(\d+)"><hp:t>2026년\s+월\s+일<\/hp:t>/g,
      (m, cid) => `<hp:run charPrIDRef="${cloner.black(cid)}"><hp:t>${xmlEsc(data.date)}</hp:t>`);
    xml = xml.replace(/<hp:t>2026년\s+월\s+일<\/hp:t>/g, `<hp:t>${xmlEsc(data.date)}</hp:t>`);
  }

  zip.file(path, xml);
  zip.file("Contents/header.xml", header.xml);
  return packageHwpx(zip);
}
