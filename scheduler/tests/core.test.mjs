import test from "node:test";
import assert from "node:assert/strict";
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
