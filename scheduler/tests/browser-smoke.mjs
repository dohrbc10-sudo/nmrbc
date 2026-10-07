import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

import { chromium } from "playwright";
fs.mkdirSync("test-results", { recursive: true });
const root = path.resolve("public");
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  try {
    const p = new URL(req.url, "http://localhost").pathname;
    const filename = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
    const body = fs.readFileSync(filename);
    res.writeHead(200, {
      "Content-Type": types[path.extname(filename)] || "text/plain",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("404");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  timezoneId: "Asia/Manila",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(url);
  await page.waitForSelector("#rosterTable tbody tr");
  assert.equal(await page.locator("#rosterTable tbody tr").count(), 10);
  assert.equal(await page.locator("#rosterTable thead th").count(), 16);
  assert.equal(await page.locator("#bulkButton").isVisible(), false);
  await page.screenshot({
    path: path.resolve("test-results/scheduler-preview.png"),
    fullPage: true,
  });
  console.log("PASS public roster and initial 1–15 view");
  await page.locator('[data-view="second"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#periodSubtitle").textContent.startsWith("Days 16"),
  );
  assert.ok((await page.locator("#rosterTable thead th").count()) >= 14);
  await page.locator('[data-view="first"]').click();
  await page.waitForFunction(() =>
    document.querySelector("#periodSubtitle").textContent.startsWith("Days 1"),
  );
  const mbd = page.locator("#rosterTable .shift.mbd").first();
  await mbd.click();
  await page.waitForSelector("dialog[open]");
  assert.match(
    await page.locator("#dialogBody").innerText(),
    /Expected donors/i,
  );
  assert.match(await page.locator("#dialogBody").innerText(), /Companions/i);
  assert.equal(await page.locator("[data-edit-event]").count(), 0);
  await page.locator("#closeDialog").click();
  console.log("PASS MBD event details without login");
  await page.locator("#personFilter").selectOption({ index: 1 });
  assert.equal(await page.locator("#rosterTable tbody tr").count(), 1);
  await page.locator("#personFilter").selectOption("");
  await page.locator("#loginButton").click();
  await page.locator("#demoLogin").click();
  assert.equal(await page.locator("#bulkButton").isVisible(), true);
  await page.locator("#rosterTable .shift.am-t").first().click();
  await page.locator("#assignmentForm select[name=code]").selectOption("PM");
  await page
    .locator("#assignmentForm textarea[name=description]")
    .fill("Coverage for evening laboratory");
  await page
    .locator("#assignmentForm textarea[name=reason]")
    .fill("Adjusted laboratory coverage");
  await page.locator("#assignmentForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  await page.waitForFunction(() =>
    document
      .querySelector("#changeList")
      .textContent.includes("Adjusted laboratory coverage"),
  );
  assert.equal(await page.locator("#updatesBanner").isVisible(), true);
  console.log("PASS admin edits and change prompt");
  await page.locator("[data-tab=personnel]").click();
  await page.locator("#addPersonnelButton").click();
  await page.locator("#personnelForm input[name=name]").fill("Test Personnel");
  await page.locator("#personnelForm input[name=role_label]").fill("Nurse");
  await page
    .locator("#personnelForm textarea[name=reason]")
    .fill("Add staff for community event");
  await page.locator("#personnelForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  await page.waitForFunction(() =>
    document
      .querySelector("#personnelList")
      .textContent.includes("Test Personnel"),
  );
  await page.locator("[data-tab=events]").click();
  await page.locator("#addEventButton").click();
  await page.locator("#eventForm input[name=title]").fill("Browser-tested MBD");
  await page.locator("#eventForm input[name=location]").fill("Test town hall");
  await page.locator("#eventForm input[name=expected_donors]").fill("60");
  await page
    .locator("#eventForm .crew-picker label")
    .filter({ hasText: "Test Personnel" })
    .locator("input")
    .check();
  await page
    .locator("#eventForm textarea[name=reason]")
    .fill("Confirm newly added event");
  await page.locator("#eventForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  await page.waitForFunction(() =>
    document
      .querySelector("#eventList")
      .textContent.includes("Browser-tested MBD"),
  );
  console.log("PASS add personnel and MBD crew assignment");
  await page.locator("[data-tab=roster]").click();
  await page.locator("#bulkButton").click();
  await page
    .locator("#bulkForm .crew-picker label")
    .filter({ hasText: "Test Personnel" })
    .locator("input")
    .check();
  await page.locator("#bulkForm select[name=code]").selectOption("AM/C");
  await page
    .locator("#bulkForm textarea[name=reason]")
    .fill("Assign routine component duties");
  await page.locator("#bulkForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  await page.waitForFunction(() =>
    document
      .querySelector("#changeList")
      .textContent.includes("Assign routine component duties"),
  );
  console.log("PASS bulk assignments skip existing MBD");
  const row = page
    .locator("#rosterTable tbody tr")
    .filter({ hasText: "Test Personnel" });
  await row.locator(".shift.mbd").click();
  await page.locator("#editMbdCell").click();
  await page.locator("#assignmentForm select[name=code]").selectOption("");
  await page
    .locator("#assignmentForm textarea[name=reason]")
    .fill("Return to routine staffing");
  await page.locator("#assignmentForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  console.log("PASS MBD cell can be cleared through its detail window");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const file = await downloadPromise;
  assert.ok(file.suggestedFilename().endsWith(".csv"));
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: path.resolve("test-results/scheduler-print-preview.pdf"),
    printBackground: true,
    preferCSSPageSize: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.locator("#logoutButton").click();
  assert.equal(await page.locator("#bulkButton").isVisible(), false);
  await page.reload();
  await page.waitForSelector("#rosterTable tbody tr");
  assert.ok((await page.locator("#rosterTable tbody tr").count()) === 11);
  assert.equal(await page.locator("#bulkButton").isVisible(), false);
  console.log("PASS logout and local demo persistence");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.resolve("test-results/scheduler-mobile-preview.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS mobile layout, CSV export, print, and no JavaScript errors",
  );
} catch (e) {
  console.log("DIALOG:", await page.locator("#dialogBody").innerText());
  await page.screenshot({
    path: path.resolve("test-results/browser-error.png"),
    fullPage: true,
  });
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
