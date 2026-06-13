// 지역(시·도) 해석기
// 우선순위: ① 번들/학습된 매핑 → ② 원DB(업로드) → ③ NEIS API → ④ 수동
export const SIDO_LIST = [
  "서울특별시", "인천광역시", "경기도", "대전광역시", "세종특별자치시",
  "강원특별자치도", "충청북도", "충청남도", "부산광역시", "대구광역시",
  "울산광역시", "경상북도", "경상남도", "광주광역시", "전북특별자치도",
  "전라남도", "제주특별자치도"
];

// 교육청명 → 시·도(드롭다운 표기) 정규화
export function officeToSido(officeName) {
  if (!officeName) return "";
  let s = String(officeName).replace(/교육청$/, "").trim();
  // NEIS는 "강원특별자치도교육청" 등 신명칭을 주므로 그대로 매칭됨
  if (SIDO_LIST.includes(s)) return s;
  // 일부 구명칭 보정
  const fix = {
    "강원도": "강원특별자치도",
    "전라북도": "전북특별자치도",
    "제주도": "제주특별자치도",
    "제주특별자치도교육청": "제주특별자치도"
  };
  if (fix[s]) return fix[s];
  // 부분 매칭(앞부분 일치)
  const hit = SIDO_LIST.find(v => s.startsWith(v) || v.startsWith(s));
  return hit || s;
}

export class RegionResolver {
  constructor() {
    this.map = {};            // 학교명 -> 시도 (번들 + 학습)
    this.neisKey = "";
    this.cache = {};          // NEIS 조회 캐시
    this.programClasses = []; // 원DB(모집현황) 학급 레코드 (비PII)
    this.dbSchools = new Set(); // 원DB 학교명
  }

  // 내장된 원DB(program_db.json) 백그라운드 로드
  async loadProgramDb(url = "data/program_db.json") {
    try {
      const res = await fetch(url);
      const json = await res.json();
      this.programClasses = json.classes || [];
      (json.schools || []).forEach(s => this.dbSchools.add(s));
      return { schools: this.dbSchools.size, classes: this.programClasses.length };
    } catch (e) {
      console.warn("program_db 로드 실패", e);
      return { schools: 0, classes: 0 };
    }
  }

  // 원DB에서 학교+프로그램으로 차시별 일정(일시) 조회 → 일시 문자열 반환
  findScheduleRaw(school, programCore) {
    const ns = (school || "").replace(/\(저조지역\)/g, "").replace(/\s+/g, "");
    const rec = this.programClasses.find(r => {
      const rs = (r["학교명"] || "").replace(/\(저조지역\)/g, "").replace(/\s+/g, "");
      if (rs !== ns) return false;
      if (!programCore) return true;
      const rp = (r["프로그램명"] || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
      return rp.includes(programCore) || programCore.includes(rp);
    });
    return rec ? (rec["일시"] || "") : "";
  }

  async loadBundle(url = "data/region_map.json") {
    try {
      const res = await fetch(url);
      const json = await res.json();
      Object.assign(this.map, json.map || {});
    } catch (e) {
      console.warn("region_map 번들 로드 실패", e);
    }
  }

  learn(school, sido) {
    if (school && sido) this.map[school] = sido;
  }

  async resolve(school) {
    if (!school) return { sido: "", source: "none" };
    const name = school.trim();
    if (this.map[name]) return { sido: this.map[name], source: "bundle" };

    // NEIS 조회 (키 없이도 동작. 키가 있으면 호출 한도가 늘어남)
    if (this.cache[name]) return { sido: this.cache[name], source: "neis(cache)" };
    try {
      const keyParam = this.neisKey ? `KEY=${encodeURIComponent(this.neisKey)}&` : "";
      const url = `https://open.neis.go.kr/hub/schoolInfo?${keyParam}Type=json&pIndex=1&pSize=5&SCHUL_NM=${encodeURIComponent(name)}`;
      const res = await fetch(url);
      const data = await res.json();
      const row = data?.schoolInfo?.[1]?.row?.[0];
      if (row?.ATPT_OFCDC_SC_NM) {
        const sido = officeToSido(row.ATPT_OFCDC_SC_NM);
        this.cache[name] = sido;
        this.learn(name, sido);
        return { sido, source: "neis" };
      }
    } catch (e) {
      console.warn("NEIS 조회 실패", name, e);
    }
    return { sido: "", source: "manual" };  // 수동 선택 필요
  }
}
