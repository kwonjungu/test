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

  // hwpx(OCF) 규칙 보존: mimetype은 STORE(무압축)·첫 엔트리 유지, 나머지는 DEFLATE.
  // (키 재지정은 기존 순서를 보존하므로 mimetype은 그대로 맨 앞)
  const mt = await zip.file("mimetype").async("uint8array");
  zip.file("mimetype", mt, { compression: "STORE" });
  // JSZip이 자동 생성하는 폴더 엔트리(Contents/ 등)는 원본에 없으므로 제거
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
