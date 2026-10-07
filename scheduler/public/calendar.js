import {
  CODES,
  CLASSES,
  html as h,
  today,
  parseDate,
  formatDate,
  monthEnd,
  datesBetween,
  addDays,
} from "./core.js";
export function monthCells(anchor) {
  const start = anchor.slice(0, 7) + "-01";
  const end = monthEnd(start);
  const offset = (parseDate(start).getUTCDay() + 6) % 7;
  const length = datesBetween(start, end).length;
  return Array.from(
    { length: Math.ceil((offset + length) / 7) * 7 },
    (_, i) => {
      const date = addDays(start, i - offset);
      return { date, inMonth: date >= start && date <= end };
    },
  );
}
export const isOnDuty = (a) => Boolean(a && !["OFF", "LEAVE"].includes(a.code));
export function calendarModel(data) {
  const eventBy = new Map(data.events.map((e) => [e.id, e]));
  const assignments = new Map();
  for (const a of data.assignments) {
    if (!assignments.has(a.work_date)) assignments.set(a.work_date, new Map());
    assignments.get(a.work_date).set(a.personnel_id, a);
  }
  const personnel = [...data.personnel].sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  const events = [...data.events].sort(
    (a, b) =>
      a.event_date.localeCompare(b.event_date) ||
      a.call_time.localeCompare(b.call_time),
  );
  return {
    eventBy,
    day(date) {
      const assigned = assignments.get(date) || new Map();
      const rows = personnel
        .filter((p) => p.active || assigned.has(p.id))
        .map((person) => ({
          person,
          assignment: assigned.get(person.id) || null,
        }));
      const duty = rows.filter((row) => isOnDuty(row.assignment));
      const counts = { AM: 0, PM: 0, MBD: 0, OFFICE: 0, TRAINING: 0 };
      for (const row of duty) {
        const code = row.assignment.code;
        const group = code.startsWith("AM") ? "AM" : code;
        counts[group] = (counts[group] || 0) + 1;
      }
      return {
        date,
        rows,
        duty,
        counts,
        events: events.filter((e) => e.event_date === date),
        unassigned: rows.filter((r) => !r.assignment).length,
      };
    },
  };
}
export function filterDayPersonnel(day, filter = "duty") {
  if (filter === "all") return day.rows;
  if (filter === "duty") return day.duty;
  return day.duty.filter((r) =>
    filter === "AM"
      ? r.assignment.code.startsWith("AM")
      : r.assignment.code === filter,
  );
}
export function monthMarkup(model, anchor, selected, showNames = false) {
  return monthCells(anchor)
    .map(({ date, inMonth }) => {
      if (!inMonth)
        return `<div class="calendar-outside" aria-hidden="true">${+date.slice(-2)}</div>`;
      const d = model.day(date),
        weekend = [0, 6].includes(parseDate(date).getUTCDay());
      const eventText = d.events
        .slice(0, 2)
        .map(
          (e) =>
            `<span class="calendar-event ${e.status === "cancelled" ? "cancelled" : ""}" title="${h(e.title + " · " + e.location + " · " + e.call_time.slice(0, 5) + " PHT · " + e.status)}"><b>${e.status === "cancelled" ? "Cancelled" : "MBD"}</b><span class="calendar-event-title"> ${h(e.title)}</span></span>`,
        )
        .join("");
      const primary = ["AM", "PM"]
        .filter((k) => d.counts[k])
        .map((k) => k + " " + d.counts[k])
        .join(" · ");
      const other = ["OFFICE", "TRAINING"]
        .filter((k) => d.counts[k])
        .map(
          (k) => (k === "OFFICE" ? "Office" : "Training") + " " + d.counts[k],
        )
        .join(" · ");
      const names =
        showNames && d.duty.length
          ? `<span class="calendar-names">${d.duty
              .slice(0, 2)
              .map((r) => h(r.person.name))
              .join(
                "<br>",
              )}${d.duty.length > 2 ? "<br>+" + (d.duty.length - 2) + " more" : ""}</span>`
          : "";
      return `<button class="calendar-date ${weekend ? "weekend" : ""} ${date === today() ? "is-today" : ""} ${date === selected ? "selected" : ""}" type="button" data-calendar-day="${date}" aria-pressed="${date === selected}" aria-label="${h(formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ", " + d.events.length + " MBD events, " + d.duty.length + " personnel on duty. View day details.")}"><span class="calendar-date-top"><strong>${+date.slice(-2)}</strong>${date === today() ? "<small>Today</small>" : ""}</span><span class="calendar-duty-total">${d.duty.length} <span>on duty</span></span>${eventText}${d.events.length > 2 ? `<span class="calendar-extra">+${d.events.length - 2} more events</span>` : ""}${primary ? '<span class="calendar-duty-summary">' + primary + "</span>" : ""}${other ? '<span class="calendar-duty-summary secondary">' + other + "</span>" : ""}${names}</button>`;
    })
    .join("");
}
export function dayEventsMarkup(day) {
  return day.events.length
    ? day.events
        .map(
          (e) =>
            `<button type="button" class="day-event-button ${e.status === "cancelled" ? "cancelled" : ""}" data-event="${e.id}"><span><strong>${h(e.title)}</strong><small>${h(e.location)}</small></span><span class="day-event-time">${h(e.call_time.slice(0, 5))} PHT<small>${h(e.status)}</small></span></button>`,
        )
        .join("")
    : '<p class="day-empty">No MBD events scheduled.</p>';
}
export function dayPersonnelMarkup(model, day, filter, admin) {
  const rows = filterDayPersonnel(day, filter);
  if (!rows.length)
    return '<p class="day-empty">No personnel match this duty filter. Choose “All personnel / statuses” to check off, leave, and unassigned records.</p>';
  return rows
    .map(({ person, assignment: a }) => {
      const e = a?.event_id ? model.eventBy.get(a.event_id) : null;
      const detail = [
        a?.description,
        e ? e.title + " · " + e.call_time.slice(0, 5) + " PHT" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const clickable = admin || a?.code === "MBD";
      const badge = clickable
        ? `<button type="button" class="shift ${a ? CLASSES[a.code] : "empty"}" data-person="${person.id}" data-date="${day.date}" aria-label="${h(person.name + ", " + (a?.code || "unassigned") + ", " + formatDate(day.date))}">${h(a?.code || "Assign")}</button>`
        : `<span class="shift readonly ${a ? CLASSES[a.code] : "empty"}">${h(a?.code || "—")}</span>`;
      return `<article class="day-personnel-row"><div><strong>${h(person.name)}</strong><small>${h(person.role_label)}${person.active ? "" : " · Archived"}</small>${detail ? "<p>" + h(detail) + "</p>" : ""}</div><div class="day-duty-badge">${badge}<small>${h(a ? CODES[a.code] : "Unassigned")}</small></div></article>`;
    })
    .join("");
}
export function calendarExportRows(data, anchor) {
  const month = anchor.slice(0, 7),
    model = calendarModel(data);
  const rows = [
    [
      "Date",
      "Type",
      "Activity / Personnel",
      "Assignment / Status",
      "Call time (PHT)",
      "Location",
      "Details",
    ],
  ];
  for (const date of datesBetween(month + "-01", monthEnd(month + "-01"))) {
    const d = model.day(date);
    for (const e of d.events)
      rows.push([
        date,
        "MBD event",
        e.title,
        e.status,
        e.call_time.slice(0, 5),
        e.location,
        e.notes,
      ]);
    for (const r of d.rows.filter((r) => r.assignment)) {
      const a = r.assignment,
        e = a.event_id ? model.eventBy.get(a.event_id) : null;
      rows.push([
        date,
        "Personnel duty",
        r.person.name,
        a.code,
        e?.call_time.slice(0, 5) || "",
        e?.location || "",
        [a.description, e?.title].filter(Boolean).join(" · "),
      ]);
    }
  }
  return rows;
}
