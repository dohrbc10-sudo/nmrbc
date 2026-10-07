import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const db = new PGlite();
const admin = "11111111-1111-4111-8111-111111111111",
  visitor = "22222222-2222-4222-8222-222222222222";
await db.exec(
  `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key,email text); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
);
await db.exec(fs.readFileSync("supabase/schema.sql", "utf8"));
await db.exec(
  `insert into auth.users values('${admin}','admin@example.test'),('${visitor}','visitor@example.test');insert into scheduler_private.admins(user_id,display_name) values('${admin}','Live test admin');set request.jwt.claim.sub='${admin}';select public.scheduler_save_personnel(null,0,'Live Staff','Technologist',0,true,'Initial team setup');reset request.jwt.claim.sub;`,
);
const root = path.resolve("public");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  try {
    const p = new URL(req.url, "http://localhost").pathname;
    const f = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
    res.writeHead(200, {
      "Content-Type": mime[path.extname(f)] || "text/plain",
    });
    res.end(fs.readFileSync(f));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (id) =>
  b64({ alg: "HS256", typ: "JWT" }) +
  "." +
  b64({
    sub: id,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }) +
  ".testsignature";
const at = token(admin),
  vt = token(visitor);
let queue = Promise.resolve(),
  calls = [];
await page.route("**/config.js", (r) =>
  r.fulfill({
    contentType: "text/javascript",
    body: `window.SCHEDULER_CONFIG={supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test',pollSeconds:300};`,
  }),
);
await context.route("https://test.supabase.co/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const body = request.postDataJSON() || {};
  const respond = (status, value) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(value),
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  if (request.method() === "OPTIONS") return respond(200, {});
  if (url.pathname === "/auth/v1/token") {
    const id = body.email === "admin@example.test" ? admin : visitor;
    const email = id === admin ? "admin@example.test" : "visitor@example.test";
    return respond(200, {
      access_token: token(id),
      refresh_token: "refresh-" + id,
      token_type: "bearer",
      expires_in: 3600,
      user: {
        id,
        email,
        aud: "authenticated",
        role: "authenticated",
        email_confirmed_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        app_metadata: { provider: "email" },
        user_metadata: {},
      },
    });
  }
  if (url.pathname === "/auth/v1/logout") return respond(200, {});
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = url.pathname.split("/").at(-1);
    calls.push(fn);
    const auth = request.headers().authorization;
    let uid = "";
    try {
      const sub = JSON.parse(
        Buffer.from(auth.split(" ")[1].split(".")[1], "base64url"),
      ).sub;
      if ([admin, visitor].includes(sub)) uid = sub;
    } catch {}
    const task = async () => {
      try {
        await db.exec("BEGIN");
        await db.exec("SET LOCAL ROLE " + (uid ? "authenticated" : "anon"));
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          uid,
        ]);
        const keys = Object.keys(body),
          args = keys.map((k) =>
            ["p_entries", "p_event"].includes(k)
              ? JSON.stringify(body[k])
              : body[k],
          );
        const sql = `select public.${fn}(${keys.map((k, i) => k + " => $" + (i + 1)).join(",")}) as result`;
        const result = (await db.query(sql, args)).rows[0].result;
        await db.exec("COMMIT");
        return { status: 200, value: result };
      } catch (e) {
        await db.exec("ROLLBACK");
        return {
          status: e.code === "42501" ? 403 : 400,
          value: { message: e.message, code: e.code },
        };
      }
    };
    const result = await (queue = queue.then(task, task));
    return respond(result.status, result.value);
  }
  return respond(404, { message: "Unexpected endpoint " + url.pathname });
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() =>
    document.querySelector("#connectionBadge").textContent.startsWith("Live"),
  );
  assert.equal(await page.locator("#modeBanner").isVisible(), false);
  assert.equal(await page.locator("#rosterTable tbody tr").count(), 1);
  await page.locator("#loginButton").click();
  await page
    .locator("#loginForm input[name=email]")
    .fill("visitor@example.test");
  await page
    .locator("#loginForm input[name=password]")
    .fill("visitorpassword123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#formError")
      .textContent.includes("not an approved"),
  );
  assert.equal(await page.locator("#bulkButton").isVisible(), false);
  await page.locator("#closeDialog").click();
  await page.locator("#loginButton").click();
  await page.locator("#loginForm input[name=email]").fill("admin@example.test");
  await page
    .locator("#loginForm input[name=password]")
    .fill("adminpassword123");
  await page.locator("#loginForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  assert.equal(await page.locator("#bulkButton").isVisible(), true);
  await page.locator("#rosterTable .shift.empty").first().click();
  await page.locator("#assignmentForm select[name=code]").selectOption("AM/C");
  await page
    .locator("#assignmentForm textarea[name=reason]")
    .fill("Live component coverage");
  await page.locator("#assignmentForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  await page.waitForSelector("#rosterTable .shift.am-c");
  assert.equal(
    (await db.query("select code from scheduler_assignments")).rows[0].code,
    "AM/C",
  );
  assert.ok(
    calls.includes("scheduler_snapshot") &&
      calls.includes("scheduler_apply_assignments"),
  );
  await page.locator("[data-tab=events]").click();
  await page.locator("#addEventButton").click();
  await page.locator("#eventForm input[name=title]").fill("Live database MBD");
  await page.locator("#eventForm input[name=location]").fill("Live test hall");
  const eventDate = (await page.locator("#monthPicker").inputValue()) + "-02";
  await page.locator("#eventForm input[name=event_date]").fill(eventDate);
  await page.locator("#eventForm input[name=crew]").check();
  await page
    .locator("#eventForm textarea[name=reason]")
    .fill("Confirm live database event");
  await page.locator("#eventForm button[type=submit]").click();
  await page.waitForSelector("dialog[open]", { state: "hidden" });
  assert.equal(
    (await db.query("select count(*)::int as n from scheduler_events")).rows[0]
      .n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from scheduler_assignments where code='MBD'",
      )
    ).rows[0].n,
    1,
  );
  await page.locator("#logoutButton").click();
  await page.reload();
  await page.waitForFunction(() =>
    document.querySelector("#connectionBadge").textContent.startsWith("Live"),
  );
  assert.equal(await page.locator("#bulkButton").isVisible(), false);
  assert.equal(await page.locator("#rosterTable .shift.mbd").count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS real browser SDK → password login → admin verification → checked SQL RPC → public refresh; ordinary user rejected; live assignment/event/crew saved and persisted",
  );
} catch (e) {
  console.log(
    "ERROR UI",
    await page.locator("#dialogBody").innerText(),
    await page.locator("#errorBanner").innerText(),
  );
  throw e;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await db.close();
}
