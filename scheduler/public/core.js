export const CODES = {
  "AM/T": "AM Testing",
  "AM/C": "AM Component processing",
  "AM/L": "AM Labelling",
  "AM/D": "AM Distribution",
  "PM/T": "PM Testing",
  "PM/C": "PM Component Processing",
  CANCELLED: "Cancelled event · Needs reassignment",
  AM: "AM · existing duty",
  PM: "PM duty",
  MBD: "Mobile blood donation",
  OFF: "Day off",
  LEAVE: "Leave",
  OFFICE: "Office duty",
  TRAINING: "Training",
};
export const CLASSES = {
  "AM/T": "am-t",
  "AM/C": "am-c",
  "AM/L": "am-c",
  "AM/D": "am",
  "PM/T": "pm",
  "PM/C": "pm",
  CANCELLED: "cancelled-duty",
  AM: "am",
  PM: "pm",
  MBD: "mbd",
  OFF: "off",
  LEAVE: "leave",
  OFFICE: "office",
  TRAINING: "training",
};
export const html = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const parseDate = (value) => new Date(`${value}T00:00:00Z`);
export const dayString = (date) => date.toISOString().slice(0, 10);
export const addDays = (value, n) => {
  const d = parseDate(value);
  d.setUTCDate(d.getUTCDate() + n);
  return dayString(d);
};
export const today = () => {
  const p = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};
export const formatDate = (
  value,
  options = { day: "numeric", month: "short", year: "numeric" },
) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", ...options }).format(
    parseDate(value),
  );
export const monthEnd = (value) =>
  dayString(new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7), 0)));
export function period(anchor, view) {
  const start = anchor.slice(0, 7) + "-01",
    end = monthEnd(anchor);
  if (view === "first") return { start, end: start.slice(0, 8) + "15" };
  if (view === "second") return { start: start.slice(0, 8) + "16", end };
  if (view === "week") {
    const offset = (parseDate(anchor).getUTCDay() + 6) % 7;
    return {
      start: addDays(anchor, -offset),
      end: addDays(anchor, 6 - offset),
    };
  }
  return { start, end };
}
export function datesBetween(start, end, weekends = true) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const w = parseDate(d).getUTCDay();
    if (weekends || (w !== 0 && w !== 6)) out.push(d);
  }
  return out;
}
export function movePeriod(anchor, view, direction) {
  if (view === "week") return { anchor: addDays(anchor, 7 * direction), view };
  if (view === "first" && direction === 1)
    return { anchor: anchor.slice(0, 7) + "-16", view: "second" };
  if (view === "second" && direction === -1)
    return { anchor: anchor.slice(0, 7) + "-01", view: "first" };
  const d = parseDate(anchor.slice(0, 7) + "-01");
  d.setUTCMonth(d.getUTCMonth() + direction);
  return {
    anchor: dayString(d),
    view: view === "first" ? "second" : view === "second" ? "first" : view,
  };
}
export const csv = (rows) =>
  rows
    .map((row) =>
      row
        .map((value) => {
          let s = String(value ?? "");
          if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
export function calendarFile(event, companions) {
  const esc = (s) =>
    String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  const time = (event.call_time || "08:00").slice(0, 5).replace(":", "") + "00";
  const date = event.event_date.replace(/-/g, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NMRBC//Scheduler//EN",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Manila",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0800",
    "TZOFFSETTO:+0800",
    "TZNAME:PHT",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${event.id}@nmrbc-scheduler`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    `DTSTART;TZID=Asia/Manila:${date}T${time}`,
    `SUMMARY:${esc(event.title)}`,
    `LOCATION:${esc(event.location)}`,
    `DESCRIPTION:${esc("Companions: " + companions.join(", ") + "\nRPO: " + (event.rpo_number || "—") + "\nVehicle: " + (event.vehicle_name || "—") + "\nVehicle details: " + (event.vehicle_details || "—") + "\nExpected donors: " + event.expected_donors + "\n" + event.notes)}`,
    `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
