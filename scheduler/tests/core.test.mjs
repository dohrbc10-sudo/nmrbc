import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mailBody } from "../public/email-template.js";
import {
  period,
  datesBetween,
  movePeriod,
  csv,
  html,
  calendarFile,
} from "../public/core.js";
test("Half-month views handle February, leap years and month lengths", () => {
  assert.deepEqual(period("2026-02-20", "second"), {
    start: "2026-02-16",
    end: "2026-02-28",
  });
  assert.equal(period("2028-02-20", "second").end, "2028-02-29");
  assert.equal(datesBetween("2026-10-16", "2026-10-31").length, 16);
});
test("Week views cross month and year boundaries without timezone drift", () => {
  assert.deepEqual(period("2027-01-01", "week"), {
    start: "2026-12-28",
    end: "2027-01-03",
  });
  assert.equal(datesBetween("2026-10-05", "2026-10-11", false).length, 5);
  assert.deepEqual(movePeriod("2026-12-01", "second", 1), {
    anchor: "2027-01-01",
    view: "first",
  });
  assert.deepEqual(movePeriod("2026-01-01", "first", -1), {
    anchor: "2025-12-01",
    view: "second",
  });
});
test("HTML and CSV protect public descriptions and spreadsheet exports", () => {
  assert.equal(html('<script>"&'), "&lt;script&gt;&quot;&amp;");
  assert.equal(
    csv([['=HYPERLINK("evil")', " +42", "safe, name"]]),
    '"\'=HYPERLINK(""evil"")","\' +42","safe, name"',
  );
});
test("Calendar export uses Philippine time and escapes descriptions", () => {
  const e = {
    id: "abc",
    title: "Drive, one",
    event_date: "2026-10-08",
    call_time: "07:30",
    location: "Hall",
    expected_donors: 100,
    notes: "Bring kit\nMeet early",
    status: "confirmed",
  };
  const value = calendarFile(e, ["A", "B"]);
  assert.match(value, /DTSTART;TZID=Asia\/Manila:20261008T073000/);
  assert.ok(value.includes("SUMMARY:Drive\\, one"));
  assert.ok(value.includes("Bring kit\\nMeet early"));
});

test("Scheduler footer links to CrimsonCore in a separate tab", () => {
  const markup = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(markup, /class="powered-by"/);
  assert.match(markup, /href="https:\/\/crimsoncore\.online\/"/);
  assert.match(markup, /rel="noopener noreferrer"/);
});

test("Reminder email preview includes CrimsonCore branding without losing schedule details", () => {
  const message = mailBody(
    {
      kind: "daily",
      recipient: "recipient@example.test",
      payload: {
        name: "Sample Staff",
        date: "2026-11-03",
        code: "MBD",
        driver: "Sample Driver",
        event: { title: "Sample Drive", location: "Sample Venue", rpo_number: "RPO-001", vehicle_name: "Van" },
      },
    },
    { from: "NMRBC <sender@example.test>", url: "https://scheduler.example.test/" },
  );
  assert.match(message.text, /Powered by CrimsonCore: https:\/\/crimsoncore\.online\//);
  assert.match(message.html, /Powered by <a href="https:\/\/crimsoncore\.online\//);
  assert.match(message.html, /View latest schedule/);
  assert.match(message.text, /Driver: Sample Driver/);
  assert.match(message.text, /RPO: RPO-001/);
  assert.match(message.text, /Vehicle: Van/);
  assert.equal(message.to[0], "recipient@example.test");
});

test("Header shows a separate clickable CrimsonCore link beside Personnel scheduling", () => {
  const markup = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const topbar = markup.split('<header class="topbar">')[1]?.split("</header>")[0] ?? "";
  assert.match(topbar, /Personnel scheduling/);
  assert.match(topbar, /class="brand-group"/);
  assert.match(topbar, /class="header-powered-by"/);
  assert.match(topbar, /href="https:\/\/crimsoncore\.online\/"/);
  assert.match(topbar, /target="_blank" rel="noopener noreferrer"/);
  assert.match(markup, /<footer class="site-footer">/);
});
