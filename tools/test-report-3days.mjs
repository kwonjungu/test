// 3일 캠프(봉명초) 결과보고서·사례집 생성 검증 하네스
// 실행: node tools/test-report-3days.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";
globalThis.JSZip = JSZip;

const { buildReportHwpx, buildCaseBookHwpx } = await import("../js/hwpx.js");

const days = [
  { date: { m: 7, d: 29 }, start: "13:00", end: "16:10" },
  { date: { m: 7, d: 30 }, start: "13:00", end: "16:10" },
  { date: { m: 7, d: 31 }, start: "13:00", end: "16:10" },
];
const data = {
  program: "(특화/다문화) 드론 모빌리티, 작전명 빛글!",
  school: "봉명초등학교",
  org: "대림대학교",
  mainTeacher: "권준구",
  assistantTeacher: "황지현",
  safetyManager: "이상민",
  equipQty: 20,
  days,
  opinions: {
    "주강사": "학생들이 드론 조작 원리를 빠르게 익혔고 협력 활동 참여도가 높았습니다. 짧은 검증용 의견입니다.",
    "보조강사": "조별 실습 보조 과정에서 학생들의 흥미와 몰입이 매우 높았습니다. 길이가 원문과 다른 검증용 텍스트로, 줄정보 불일치 검출을 위해 일부러 길게 작성합니다. 이 문장 역시 검증 목적입니다.",
    "안전관리자": "운영 전후 안전 점검을 실시하였고 특이사항은 없었습니다."
  },
  studentNames: ["김민준", "이서연", "박도윤"],
  teacher: "황지현",
  reviews: {
    "학생": "드론을 직접 날려 본 게 처음이라 정말 재미있었어요. 검증용 후기입니다.",
    "학부모": "아이가 집에 와서도 캠프 이야기를 계속 했습니다. 검증용 후기 텍스트입니다.",
    "강사": "학생들이 끝까지 집중하며 참여해 준 인상적인 캠프였습니다."
  }
};

await mkdir(new URL("./out/", import.meta.url), { recursive: true });

const reportTpl = await readFile("templates/결과보고서양식.hwpx");
const reportBlob = await buildReportHwpx(reportTpl.buffer.slice(reportTpl.byteOffset, reportTpl.byteOffset + reportTpl.byteLength), data);
await writeFile("tools/out/결과보고서_테스트_3일.hwpx", Buffer.from(await reportBlob.arrayBuffer()));

const caseTpl = await readFile("templates/프로그램운영사례집양식.hwpx");
const caseBlob = await buildCaseBookHwpx(caseTpl.buffer.slice(caseTpl.byteOffset, caseTpl.byteOffset + caseTpl.byteLength), data);
await writeFile("tools/out/사례집_테스트.hwpx", Buffer.from(await caseBlob.arrayBuffer()));

console.log("generated: tools/out/결과보고서_테스트_3일.hwpx, tools/out/사례집_테스트.hwpx");
