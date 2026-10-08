import {
  CODES,
  html as h,
  today,
  formatDate,
  datesBetween,
  monthEnd,
  parseDate,
  addDays,
} from "./core.js";
import {
  roleOf,
  dutyGroup,
  orderedPeople,
  companionsMarkup,
  driverLabel,
  needsDriver,
} from "./logistics.js";
import { calendarModel } from "./calendar.js";
const $ = (id) => document.getElementById(id);
const names = (rows) =>
  rows.map((r) => ({
    ...r.person,
    code: r.assignment?.code,
    description: r.assignment?.description,
    event_id: r.assignment?.event_id,
  }));
export function dayViewMarkup(data, date, admin = false) {
  const model = calendarModel(data),
    day = model.day(date),
    counts = day.counts;
  const groups = [
    "AM",
    "PM",
    "MBD",
    "OFFICE",
    "TRAINING",
    "CANCELLED",
    "OFF",
    "LEAVE",
    "UNASSIGNED",
  ];
  const groupRows = (k) =>
    day.rows.filter((r) =>
      k === "UNASSIGNED" ? !r.assignment : dutyGroup(r.assignment?.code) === k,
    );
  const eventCards = day.events
    .map((e) => {
      const crew = data.assignments
        .filter((a) => a.event_id === e.id)
        .map((a) => data.personnel.find((p) => p.id === a.personnel_id))
        .filter(Boolean);
      return `<article class="expanded-event"><div class="expanded-event-head"><h3>${h(e.title)}</h3><span class="status ${h(e.status)}">${h(e.status)}</span></div><p class="event-place">${h(e.location)}</p><dl class="expanded-event-facts"><div><dt>Call time</dt><dd>${h(e.call_time.slice(0, 5))} PHT${e.end_time ? " · Ends " + h(e.end_time.slice(0, 5)) : ""}</dd></div><div><dt>Expected donors</dt><dd>${e.expected_donors}</dd></div><div><dt>Driver</dt><dd>${h(driverLabel(e, data.personnel))}</dd></div><div><dt>RPO / Vehicle</dt><dd>${h([e.rpo_number, e.vehicle_name].filter(Boolean).join(" · ") || "For arrangement")}</dd></div></dl>${e.vehicle_details ? "<p>" + h(e.vehicle_details) + "</p>" : ""}${needsDriver(e, data) ? '<p class="driver-warning">⚠ Driver arrangement is pending.</p>' : ""}${e.notes ? '<p class="expanded-event-notes">' + h(e.notes) + "</p>" : ""}<details><summary>Companions · ${crew.length}${e.driver_mode === "other" ? " + other driver" : ""}</summary>${companionsMarkup(crew, e)}</details><button class="button outline" data-event="${h(e.id)}">${admin ? "View / edit activity" : "View full details"}</button></article>`;
    })
    .join("");
  const sections = groups
    .filter((k) => groupRows(k).length)
    .map((k) => {
      const rows = groupRows(k),
        title =
          k === "UNASSIGNED"
            ? "Unassigned"
            : k === "CANCELLED"
              ? "⚠ Needs reassignment"
              : k;
      return `<section class="day-duty-group ${k === "CANCELLED" ? "needs-reassignment" : ""}"><h3>${h(title)} <span class="count">${rows.length}</span></h3><ul>${orderedPeople(
        names(rows),
      )
        .map(
          (p) =>
            `<li><div><strong>${h(p.name)}</strong><small>${h(roleOf(p))} ${p.code ? " · " + h(p.code) : ""}</small>${p.description ? "<p>" + h(p.description) + "</p>" : ""}${p.event_id ? "<p>" + h(model.eventBy.get(p.event_id)?.title || "Linked activity") + "</p>" : ""}</div><button class="button quiet" data-person="${h(p.id)}" data-date="${date}" ${!admin && !p.code ? "disabled" : ""}>${admin ? "Open" : "Details"}</button></li>`,
        )
        .join("")}</ul></section>`;
    })
    .join("");
  return `<div class="expanded-day-toolbar"><button class="button outline" data-day-step="-1">‹ Previous day</button><span>${day.duty.length} on duty · AM ${counts.AM} · PM ${counts.PM} · MBD ${counts.MBD}</span><button class="button outline" data-day-step="1">Next day ›</button>${admin ? '<button id="dayAddActivity" class="button primary">＋ Add activity</button>' : ""}</div><div class="expanded-day-layout"><section class="expanded-day-events"><h2>Activities <span class="count">${day.events.length}</span></h2>${eventCards || '<p class="day-empty">No activities scheduled for this date.</p>'}</section><section class="expanded-day-duties"><h2>Personnel by duty</h2><div class="day-duty-groups">${sections || '<p class="day-empty">No personnel records.</p>'}</div></section></div>`;
}
export function printRosterMarkup(data, anchor, organization) {
  const start = anchor.slice(0, 7) + "-01",
    end = monthEnd(start),
    dates = datesBetween(start, end),
    events = data.events
      .filter((e) => e.event_date >= start && e.event_date <= end)
      .sort(
        (a, b) =>
          a.event_date.localeCompare(b.event_date) ||
          a.call_time.localeCompare(b.call_time),
      );
  const refs = new Map(events.map((e, i) => [e.id, "E" + (i + 1)])),
    assigned = new Map(
      data.assignments
        .filter((a) => a.work_date >= start && a.work_date <= end)
        .map((a) => [a.personnel_id + "|" + a.work_date, a]),
    );
  const people = data.personnel
    .filter(
      (p) =>
        p.active ||
        data.assignments.some(
          (a) =>
            a.personnel_id === p.id &&
            a.work_date >= start &&
            a.work_date <= end,
        ),
    )
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
  const rows = people
    .map(
      (p) =>
        `<tr><th><strong>${h(p.name)}</strong><small>${h(p.role_label)}</small></th>${dates
          .map((d) => {
            const a = assigned.get(p.id + "|" + d);
            return `<td class="${a?.code === "CANCELLED" ? "print-cancelled" : ""}"><b>${h(a?.code === "CANCELLED" ? "⚠" : a?.code || "—")}</b>${a?.event_id ? "<small>" + h(refs.get(a.event_id) || "") + "</small>" : ""}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const details = events
    .map((e) => {
      const crew = orderedPeople(
        data.assignments
          .filter((a) => a.event_id === e.id)
          .map((a) => data.personnel.find((p) => p.id === a.personnel_id))
          .filter(Boolean),
      );
      return `<article class="print-event"><h3>${h(refs.get(e.id))} · ${h(e.title)} · ${+e.event_date.slice(-2)} ${h(formatDate(e.event_date, { month: "short" }))} · ${h(e.status)}</h3><p><b>${h(e.location)}</b> · ${h(e.call_time.slice(0, 5))} PHT${e.end_time ? "–" + h(e.end_time.slice(0, 5)) : ""} · Donors ${e.expected_donors}</p><p>Driver: ${h(driverLabel(e, data.personnel))} · RPO: ${h(e.rpo_number || "—")} · Vehicle: ${h(e.vehicle_name || "—")}${e.vehicle_details ? " · " + h(e.vehicle_details) : ""}</p><p>Team: ${h(crew.map((p) => p.name + " (" + roleOf(p) + ")").join("; ") || "Not assigned")}${e.driver_mode === "other" ? "; " + h(e.other_driver_name || "Pending") + " (Driver)" : ""}</p>${e.transport ? "<p>Transport / meeting point: " + h(e.transport) + "</p>" : ""}${e.contact_person ? "<p>Contact: " + h(e.contact_person) + "</p>" : ""}${e.notes ? '<p class="print-notes">' + h(e.notes) + "</p>" : ""}</article>`;
    })
    .join("");
  const notes = data.assignments
    .filter(
      (a) =>
        a.work_date >= start &&
        a.work_date <= end &&
        a.description &&
        a.code !== "CANCELLED",
    )
    .map(
      (a) =>
        `${data.personnel.find((p) => p.id === a.personnel_id)?.name || "Personnel"} · ${+a.work_date.slice(-2)} ${formatDate(a.work_date, { month: "short" })} · ${a.code}: ${a.description}`,
    );
  const legend = Object.entries(CODES)
    .map(
      ([code, label]) =>
        `<span><b>${h(code === "CANCELLED" ? "⚠" : code)}</b> ${h(label)}</span>`,
    )
    .join("");
  return `<div class="print-sheet"><div class="print-content"><header class="print-document-heading"><h1>${h(organization)}</h1><h2>Personnel schedule · ${h(formatDate(start, { month: "long", year: "numeric" }))}</h2><p>Philippine time (UTC+8) · ${people.length} personnel · Whole month</p></header><table class="print-roster"><caption class="visually-hidden">Whole-month personnel roster</caption><thead><tr><th>Personnel / role</th>${dates.map((d) => `<th>${+d.slice(-2)}<small>${h(formatDate(d, { weekday: "short" }))}</small></th>`).join("")}</tr></thead><tbody>${rows || "<tr><td>No personnel added.</td></tr>"}</tbody></table><div class="print-code-legend">${legend}</div>${details ? '<section class="print-activities"><h2>Activity details · match E1, E2… to the roster</h2><div class="print-event-grid">' + details + "</div></section>" : ""}${notes.length ? '<section class="print-duty-notes"><h2>Duty instructions</h2>' + notes.map((n) => "<p>" + h(n) + "</p>").join("") + "</section>" : ""}<p class="print-document-footer">— Unassigned, not a day off. ⚠ Cancelled activity: needs a new duty. Personnel sharing an AM or PM date column are shift companions. Verify the latest online roster before reporting.</p></div></div>`;
}
export function createViewControls({
  getState,
  organization,
  openDialog,
  addEvent,
  toast,
  onDaySelection,
}) {
  let compact = localStorage.getItem("scheduler-density") === "compact",
    fullscreen = false,
    raf = 0;
  const mq = matchMedia("(prefers-color-scheme: dark)");
  let preference = ["light", "dark", "system"].includes(
    localStorage.getItem("scheduler-theme"),
  )
    ? localStorage.getItem("scheduler-theme")
    : "light";
  const theme = () => {
    document.documentElement.dataset.theme =
      preference === "system" ? (mq.matches ? "dark" : "light") : preference;
    document
      .querySelectorAll("[data-theme-picker]")
      .forEach((el) => (el.value = preference));
  };
  document.querySelectorAll("[data-theme-picker]").forEach((el) =>
    el.addEventListener("change", () => {
      preference = el.value;
      localStorage.setItem("scheduler-theme", preference);
      theme();
    }),
  );
  mq.addEventListener?.("change", theme);
  theme();
  const output = document.createElement("div");
  output.id = "viewPrintOutput";
  output.setAttribute("aria-hidden", "true");
  document.body.append(output);
  const fit = () => {
    const table = $("rosterTable"),
      stage = $("rosterStage"),
      scroll = $("rosterScroll");
    if (!table || !stage) return;
    const active = compact || fullscreen;
    document.body.classList.toggle("compact-roster", active);
    $("normalView").setAttribute("aria-pressed", String(!active));
    $("compactView").setAttribute("aria-pressed", String(active));
    $("normalView").disabled = fullscreen;
    $("compactView").disabled = fullscreen;
    $("compactStatus").hidden = !active;
    if (!active || getState().tab !== "roster") {
      table.style.removeProperty("--fit-table-width");
      table.style.removeProperty("--roster-scale");
      stage.style.height = "";
      return;
    }
    const available = Math.max(
        80,
        innerHeight -
          scroll.getBoundingClientRect().top -
          ($("rosterPanel").querySelector(".roster-footer").offsetHeight ||
            22) -
          20,
      ),
      width = scroll.clientWidth;
    table.style.setProperty("--roster-scale", "1");
    table.style.setProperty("--fit-table-width", width + "px");
    let scale = Math.min(1, available / Math.max(1, table.offsetHeight));
    table.style.setProperty("--fit-table-width", width / scale + "px");
    scale = Math.min(1, available / Math.max(1, table.offsetHeight));
    table.style.setProperty("--roster-scale", String(scale));
    stage.style.height = table.offsetHeight * scale + "px";
    $("compactStatus").textContent =
      `${table.tBodies[0]?.rows.length || 0} personnel fitted · ${Math.round(scale * 100)}%`;
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fit);
  };
  $("normalView").onclick = () => {
    compact = false;
    localStorage.setItem("scheduler-density", "normal");
    schedule();
  };
  $("compactView").onclick = () => {
    compact = true;
    localStorage.setItem("scheduler-density", "compact");
    window.scrollTo({ top: 0 });
    schedule();
  };
  const setFullscreen = (value) => {
    fullscreen = value;
    document.body.classList.toggle("roster-fullscreen", value);
    $("fullscreenButton").textContent = value
      ? "⛶ Exit full screen"
      : "⛶ Full screen";
    $("fullscreenButton").setAttribute("aria-pressed", String(value));
    window.scrollTo({ top: 0 });
    schedule();
  };
  const exit = async () => {
    setFullscreen(false);
    if (document.fullscreenElement)
      try {
        await document.exitFullscreen();
      } catch {}
  };
  $("fullscreenButton").onclick = async () => {
    if (fullscreen) return exit();
    setFullscreen(true);
    if (document.documentElement.requestFullscreen)
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        toast("Full-window roster enabled. Use Exit full screen to return.");
      }
  };
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && fullscreen) setFullscreen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fullscreen && !$("mainDialog").open) exit();
  });
  window.addEventListener("resize", () => {
    schedule();
    fitPreview();
  });
  new ResizeObserver(() => schedule()).observe($("rosterPanel"));
  function fitSheet(sheet) {
    const content = sheet?.querySelector(".print-content");
    if (!content) return;
    const width = sheet.clientWidth,
      height = sheet.clientHeight;
    if (!width || !height) return;
    content.style.transform = "none";
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      content.style.width = width / scale + "px";
      const next = Math.min(1, (height - 2) / content.scrollHeight);
      if (Math.abs(next - scale) < 0.0001) break;
      scale = next;
    }
    content.style.width = width / scale + "px";
    scale = Math.min(scale, (height - 2) / content.scrollHeight);
    content.style.transform = `scale(${scale})`;
    sheet.dataset.fit = String(scale);
  }
  function fitPreview() {
    document.querySelectorAll(".print-sheet").forEach(fitSheet);
    const frame = $("dialogBody").querySelector(".print-preview-frame"),
      sheet = frame?.querySelector(".print-sheet");
    if (frame && sheet) {
      const scale = Math.min(1, frame.clientWidth / sheet.offsetWidth);
      sheet.style.setProperty("--preview-scale", String(scale));
      frame.style.height = sheet.offsetHeight * scale + 4 + "px";
    }
  }
  function openPrint() {
    const state = getState(),
      html = printRosterMarkup(state.data, state.anchor, organization());
    openDialog(
      "Whole-month print view",
      `<div class="print-preview-tools"><span>A4 landscape · One page · Dates, duties, and activity details</span><button id="printSheetButton" class="button primary">Print / Save PDF</button></div><div class="print-preview-frame">${html}</div>`,
      "print-view-dialog",
    );
    output.innerHTML = html;
    document.body.classList.add("print-sheet-mode");
    $("printSheetButton").onclick = () => {
      fitPreview();
      window.print();
    };
    requestAnimationFrame(fitPreview);
  }
  function openDay(date) {
    const state = getState();
    openDialog(
      formatDate(date, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      dayViewMarkup(state.data, date, state.admin),
      "day-view-dialog",
    );
    $("mainDialog").dataset.dayView = date;
    const prev = $("dialogBody").querySelector('[data-day-step="-1"]'),
      next = $("dialogBody").querySelector('[data-day-step="1"]');
    const start = state.anchor.slice(0, 7) + "-01",
      end = monthEnd(start);
    prev.disabled = date <= start;
    next.disabled = date >= end;
    if (state.admin) $("dayAddActivity").onclick = () => addEvent(date);
  }
  $("printViewButton").onclick = openPrint;
  $("dialogBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day-step]");
    if (b && !b.disabled) {
      const date = addDays(
        $("mainDialog").dataset.dayView,
        Number(b.dataset.dayStep),
      );
      getState().calendarDate = date;
      onDaySelection?.(date);
      openDay(date);
    }
  });
  $("mainDialog").addEventListener("close", () => {
    document.body.classList.remove("print-sheet-mode");
    output.innerHTML = "";
    delete $("mainDialog").dataset.dayView;
  });
  window.addEventListener("beforeprint", () => {
    if (document.body.classList.contains("print-sheet-mode")) {
      output.querySelectorAll(".print-sheet").forEach(fitSheet);
    } else {
      document.body.classList.add("native-printing");
    }
  });
  window.addEventListener("afterprint", () =>
    document.body.classList.remove("native-printing"),
  );
  return {
    openPrint,
    openDay,
    update() {
      const s = getState();
      $("viewPeriodLabel").textContent =
        formatDate(s.anchor, { month: "long", year: "numeric" }) +
        (s.view === "month" ? " · Whole month" : "");
      if ($("mainDialog").open && $("mainDialog").dataset.dayView) {
        const date = $("mainDialog").dataset.dayView;
        openDay(date);
      }
      schedule();
    },
    exit,
  };
}
