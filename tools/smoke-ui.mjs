// UI 스모크 테스트 — 가천대: 원DB 드롭다운 → 변환 → 강의보고서 다운로드 파일명 확인
// 실행: node tools/smoke-ui.mjs  (사전: python -m http.server 8123)
import { chromium } from "playwright";

const ok = (c, m) => { console.log((c ? "ok: " : "FAIL: ") + m); if (!c) process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", e => ok(false, "pageerror: " + e.message));
page.on("dialog", async d => { await d.accept("테스트소속"); });

await page.goto("http://localhost:8123/index.html");
await page.click('.org-pick[data-org="가천대학교"]');
await page.waitForTimeout(1500);

// 드롭다운 채워짐
const optCount = await page.locator("#campSelect option").count();
ok(optCount > 1, `campSelect 옵션 ${optCount}개 (원DB 로드)`);

// 가천대 캠프 하나 선택
const label = await page.locator("#campSelect option").nth(1).textContent();
await page.selectOption("#campSelect", { index: 1 });
console.log("   선택:", label.trim());
await page.waitForTimeout(300);
ok(await page.locator(".clsbox").count() > 0, "설정 패널 렌더됨");
ok(await page.locator("#flowSteps .fstep.is-current[data-step='2']").count() === 1, "스테퍼 2단계 표시");

// 일정 자동 적용 확인
const dateVal = await page.locator(".dayrow .dDate").first().inputValue();
ok(!!dateVal, `원DB 일정 자동 입력됨: ${dateVal}`);

// 주강사·보조·안전 이름 입력
await page.locator('[id^="teacher_"]').first().fill("김주강");
await page.locator('[id^="assist_"]').first().fill("이보조");
await page.locator('[id^="safety_"]').first().fill("박안전");

// 변환
await page.click("#convertBtn");
await page.waitForTimeout(2500);
const st = await page.locator("#convertStatus").textContent();
ok(/변환 완료/.test(st), "변환 완료: " + st.trim());
ok(await page.locator("#flowSteps .fstep.is-current[data-step='4']").count() === 1, "스테퍼 4단계 표시");

// 강의보고서(주강사) 다운로드 → 파일명 확인
ok(!(await page.locator("#gDlLectureMain").isDisabled()), "강의보고서(주) 버튼 활성");
const [dl] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.click("#gDlLectureMain")
]);
const fn = dl.suggestedFilename();
console.log("   파일명:", fn);
ok(fn.startsWith("[2026 가천대 디지털 새싹] 1기 강의보고서 ("), "강의보고서 파일명 구글폼 양식");

// 결과보고서 파일명 (AI 의견은 API 없음 → 실패 허용, 파일명만 확인)
const [dl2] = await Promise.all([
  page.waitForEvent("download", { timeout: 30000 }),
  page.click("#gDlReport")
]);
console.log("   파일명:", dl2.suggestedFilename());
ok(dl2.suggestedFilename().startsWith("[2026 가천대 디지털 새싹] 1기 결과 보고서("), "결과보고서 파일명 구글폼 양식");

// 배너 다운로드
const [dl3] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  page.click("#gDlBanner")
]);
ok(/\.pptx$/.test(dl3.suggestedFilename()), "가천대 배너 pptx: " + dl3.suggestedFilename());

await page.screenshot({ path: "tools/out/smoke_gachon.png", fullPage: true });

// ── 대림대: 배너 버튼 + 드롭다운 ──
const page2 = await browser.newPage();
page2.on("pageerror", e => ok(false, "대림 pageerror: " + e.message));
await page2.goto("http://localhost:8123/index.html");
await page2.click('.org-pick[data-org="대림대학교"]');
await page2.waitForTimeout(1500);
// 원DB에 대림대 캠프 레코드가 없으므로 드롭다운은 비활성이 정상 — 명단 업로드 경로로 검증
const dDisabled = await page2.locator("#campSelect").isDisabled();
ok(dDisabled, "대림대: 원DB 캠프 없음 → 드롭다운 비활성(정상)");
await page2.setInputFiles("#rosterFile", "examples/예시_백암초_캠프명단.xlsx");
await page2.waitForTimeout(1200);
ok(await page2.locator(".clsbox").count() > 0, "대림대: 예시 명단 파싱됨");
await page2.click("#convertBtn");
await page2.waitForTimeout(2500);
ok(/변환 완료/.test(await page2.locator("#convertStatus").textContent()), "대림대 변환 완료");
ok(!(await page2.locator("#downloadBannerBtn").isDisabled()), "대림대 배너 버튼 활성");
const [dl4] = await Promise.all([
  page2.waitForEvent("download", { timeout: 15000 }),
  page2.click("#downloadBannerBtn")
]);
ok(/^배너_.*\.pptx$/.test(dl4.suggestedFilename()), "대림대 배너 pptx: " + dl4.suggestedFilename());
await dl4.saveAs("tools/out/대림배너_스모크.pptx");
await page2.screenshot({ path: "tools/out/smoke_daelim.png", fullPage: true });

await browser.close();
console.log("done");
