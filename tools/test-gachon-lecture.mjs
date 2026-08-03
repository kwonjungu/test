// 가천대 강의보고서·업무보고서 — 프로그램명/활동내용 프로그램별 치환 검증
// 실행: node tools/test-gachon-lecture.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";
globalThis.JSZip = JSZip;

const { buildGachonLectureHwpx, buildGachonWorkHwpx } = await import("../js/hwpx_gachon.js");

const days = [
  { date: { m: 8, d: 4 }, start: "09:00", end: "12:10", chasi: 4 },
  { date: { m: 8, d: 5 }, start: "09:00", end: "12:10", chasi: 4 },
];

const texts = async (blob) => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("Contents/section0.xml").async("string");
  return [...xml.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map(m => m[1]);
};
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok:", msg); };

await mkdir(new URL("./out/", import.meta.url), { recursive: true });
const tpl = await readFile("templates/gachon/강의보고서양식.hwpx");
const tplBuf = tpl.buffer.slice(tpl.byteOffset, tpl.byteOffset + tpl.byteLength);

// 1) 주강사 — 코드블루
let blob = await buildGachonLectureHwpx(tplBuf, {
  program: "(초저) 코드블루! 도시의 골든타임을 지켜라", school: "한솔초",
  name: "김철수", role: "주강사", days
});
let t = (await texts(blob)).join("\n");
assert(!t.includes("알고리즘 타고 건강으로 GO!"), "주강사: 기본 프로그램명 제거됨");
assert(t.includes("코드블루! 도시의 골든타임을 지켜라"), "주강사: 실제 프로그램명 삽입됨");
assert(t.includes("응급 상황 분류와 구급 로봇 코딩"), "주강사: 프로그램별 활동내용 삽입됨");
assert(t.includes("2. 역할 : 주강사"), "주강사: 역할 줄 유지");
assert(t.includes("김철수"), "주강사: 성명 치환");
await writeFile("tools/out/강의보고서_주강사_코드블루.hwpx", Buffer.from(await blob.arrayBuffer()));

// 2) 보조강사 — 마음건강 탐험대
blob = await buildGachonLectureHwpx(tplBuf, {
  program: "(초저) AI 휴로와 떠나는 마음건강 탐험대", school: "백암초",
  name: "이영희", role: "보조강사", days
});
t = (await texts(blob)).join("\n");
assert(!t.includes("알고리즘 타고 건강으로 GO!"), "보조: 기본 프로그램명 제거됨");
assert(t.includes("AI 휴로와 떠나는 마음건강 탐험대"), "보조: 실제 프로그램명 삽입됨");
assert(t.includes("프로그램 운영 보조강사,"), "보조: 활동내용 역할 반영");
assert(t.includes("휴머노이드 로봇 교감 코딩"), "보조: 프로그램별 활동내용 삽입됨");
assert(t.includes("2. 역할 : 보조강사"), "보조: 역할 줄 치환");
assert(t.includes("1회 X 4시간 X 45,000원 = 180,000원"), "보조: 단가 45,000 산출");
await writeFile("tools/out/강의보고서_보조_마음건강.hwpx", Buffer.from(await blob.arrayBuffer()));

// 3) 업무보고서(안전) — 메디컬DX
const wtpl = await readFile("templates/gachon/업무보고서양식.hwpx");
blob = await buildGachonWorkHwpx(wtpl.buffer.slice(wtpl.byteOffset, wtpl.byteOffset + wtpl.byteLength), {
  program: "(중등) AI와 로보틱스로 여는 메디컬DX", school: "봉명중",
  name: "박안전", days, totalAmount: "240,000", rounds: 4,
  calcLine: "20,000원 X 8시간 (반별 1일 한도 60,000원 적용) = 240,000원"
});
t = (await texts(blob)).join("\n");
assert(!t.includes("알고리즘 타고 건강으로 GO!"), "안전: 기본 프로그램명 제거됨");
assert(t.includes("AI와 로보틱스로 여는 메디컬DX"), "안전: 실제 프로그램명 삽입됨");
assert(t.includes("2. 역할 : 안전관리자"), "안전: 역할 오타(전관리자) 보정");
await writeFile("tools/out/업무보고서_안전_메디컬DX.hwpx", Buffer.from(await blob.arrayBuffer()));

console.log("done");
