// 전 서류 일괄 다운로드 수집 — 보안성 검사(높음) 테스트용 산출물 생성
// 실행: python -m http.server 8123 후 node tools/collect-all-docs.mjs
// 산출: tools/out/security/*.hwpx|pptx|xlsx
import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const OUT = "tools/out/security";
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
let saved = 0;

async function collectClicks(page, ids, tag) {
  for (const id of ids) {
    const btn = page.locator("#" + id);
    if (!(await btn.count())) { console.log(`  skip(${tag}/${id}): 없음`); continue; }
    if (await btn.isDisabled()) { console.log(`  skip(${tag}/${id}): 비활성`); continue; }
    const dls = [];
    const onDl = d => dls.push(d);
    page.on("download", onDl);
    await btn.click();
    await page.waitForTimeout(3000);   // 클래스별 다중 다운로드(350ms 간격) 대기
    page.off("download", onDl);
    for (const d of dls) {
      const fn = `${tag}__${d.suggestedFilename()}`;
      await d.saveAs(path.join(OUT, fn));
      saved++;
      console.log(`  saved: ${fn}`);
    }
    if (!dls.length) console.log(`  WARN(${tag}/${id}): 다운로드 없음`);
  }
}

// 클래스 편집 패널에서 1일차 날짜를 기준으로 3일치로 확장(3일 캠프 회귀 검증)
async function makeThreeDays(page) {
  const boxes = page.locator(".clsbox");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) {
    const box = boxes.nth(i);
    const first = await box.locator(".dayrow .dDate").first().inputValue();
    const m = first.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (!m) continue;
    const mm = +m[1]; let dd = +m[2];
    // 기존 일차 삭제 후 3일 재구성
    while (await box.locator(".dayrow").count() > 1) {
      await box.locator(".dayrow .delDay").last().click();
    }
    for (let k = 1; k <= 2; k++) await box.locator(".addDay").click();
    const rows = box.locator(".dayrow");
    for (let k = 0; k < 3; k++) {
      await rows.nth(k).locator(".dDate").fill(`${mm}월 ${dd + k}일`);
    }
  }
}

// ── 가천대: 원DB 드롭다운 → 3일 확장 → 전 서류 ──
{
  const page = await browser.newPage();
  page.on("dialog", d => d.accept("테스트소속"));
  page.on("pageerror", e => console.log("PAGEERROR(가천):", e.message));
  await page.goto("http://localhost:8123/index.html");
  await page.click('.org-pick[data-org="가천대학교"]');
  await page.waitForTimeout(1800);
  await page.selectOption("#campSelect", { index: 1 });
  await page.waitForTimeout(400);
  await makeThreeDays(page);
  await page.locator('[id^="teacher_"]').first().fill("김주강");
  await page.locator('[id^="assist_"]').first().fill("이보조");
  await page.locator('[id^="safety_"]').first().fill("박안전");
  await page.click("#convertBtn");
  await page.waitForTimeout(2500);
  await collectClicks(page, [
    "gDlXlsx", "gDlBanner", "gDlEquip", "gDlLectureMain", "gDlReport",
    "gDlMeal", "gDlMaterial", "gDlLectureAssist", "gDlPledge",
    "gDlSafetyReport", "gDlSafetyChecklist", "gDlWork"
  ], "가천");
  await page.close();
}

// ── 대림대: 예시 명단 업로드 → 3일 확장 + 다문화 체크 → 전 서류 ──
{
  const page = await browser.newPage();
  page.on("dialog", d => d.accept("테스트"));
  page.on("pageerror", e => console.log("PAGEERROR(대림):", e.message));
  await page.goto("http://localhost:8123/index.html");
  await page.click('.org-pick[data-org="대림대학교"]');
  await page.waitForTimeout(1800);
  await page.setInputFiles("#rosterFile", "examples/예시_백암초_캠프명단.xlsx");
  await page.waitForTimeout(1500);
  await makeThreeDays(page);
  await page.locator('[id^="teacher_"]').first().fill("김주강");
  await page.locator('[id^="assist_"]').first().fill("이보조");
  await page.locator('[id^="safety_"]').first().fill("박안전");
  // 다문화 확인서 활성화를 위해 첫 클래스 다문화 체크(다이얼로그 자동 수락)
  await page.locator(".socialChk").first().check();
  await page.click("#convertBtn");
  await page.waitForTimeout(3500);
  await collectClicks(page, [
    "downloadBtn", "downloadBannerBtn", "downloadHwpxBtn", "downloadEquipBtn",
    "downloadJuPayBtn", "downloadReportBtn", "downloadPayBtn", "downloadMultiBtn",
    "downloadHwpx2Btn", "downloadPledgeBtn", "downloadSafetyBtn", "downloadChecklistBtn",
    "downloadCaseBtn", "downloadSafetyPayBtn", "downloadSafetyContractBtn"
  ], "대림");
  await page.close();
}

await browser.close();
console.log(`done: ${saved} files -> ${OUT}`);
