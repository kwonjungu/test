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
    this.map = {};          // 학교명 -> 시도 (번들 + 학습)
    this.neisKey = "";
    this.cache = {};        // NEIS 조회 캐시
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

  // 원DB(대림대/가천대 모집현황 등)에서 학교명->지역 학습
  // rows: [{지역, 학교명}] 형태
  learnFromDb(rows) {
    let n = 0;
    for (const r of rows) {
      const school = (r["학교명"] || "").toString().split(/\s|\(/)[0].trim();
      const region = (r["지역"] || "").toString().trim();
      // 원DB의 '지역'은 권역(서울인천/강원충청 등)이므로 시·도로는 못 쓰고,
      // 학교명만 확보해 NEIS 조회 후보로 둔다. (권역→시도 직접 매핑은 안 함)
      if (school) { this.map["__dbschools__"] = this.map["__dbschools__"] || {}; this.map["__dbschools__"][school] = region; n++; }
    }
    return n;
  }

  async resolve(school) {
    if (!school) return { sido: "", source: "none" };
    const name = school.trim();
    if (this.map[name]) return { sido: this.map[name], source: "bundle" };

    // NEIS 조회
    if (this.neisKey) {
      if (this.cache[name]) return { sido: this.cache[name], source: "neis(cache)" };
      try {
        const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${encodeURIComponent(this.neisKey)}&Type=json&pIndex=1&pSize=5&SCHUL_NM=${encodeURIComponent(name)}`;
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
    }
    return { sido: "", source: "manual" };  // 수동 선택 필요
  }
}
