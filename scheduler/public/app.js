import {
  ROLES,
  TITLES,
  roleOf,
  dutyGroup,
  eventDuty,
  orderedPeople,
  companionsMarkup,
  driverLabel,
  needsDriver,
  shiftCompanions,
  assignmentTooltip,
  setupDutyPicker,
} from "./logistics.js";
import { createClient } from "./vendor/supabase.js";
import {
  CODES,
  CLASSES,
  html as h,
  today,
  parseDate,
  formatDate,
  monthEnd,
  period,
  datesBetween,
  movePeriod,
  csv,
  calendarFile,
} from "./core.js";
import { DemoStore, LiveStore } from "./data.js";
import {
  calendarModel,
  monthMarkup,
  dayEventsMarkup,
  dayPersonnelMarkup,
  calendarExportRows,
} from "./calendar.js";
const $ = (id) => document.getElementById(id);
const config = window.SCHEDULER_CONFIG || {};
const s = {
  anchor: today(),
  view: "first",
  tab: "roster",
  admin: false,
  data: { personnel: [], events: [], assignments: [], changes: [] },
  filter: localStorage.getItem("scheduler-person-filter") || "",
  query: "",
  weekends: true,
  sync: null,
  epoch: 0,
  saving: false,
  calendarDate: today(),
  calendarNames: false,
  calendarDuty: "duty",
};
let store,
  client,
  demo = false,
  timer,
  toastTimer;
const seenKey = "scheduler-seen-" + (config.supabaseUrl || "demo");
const selection = () =>
  period(s.anchor, s.tab === "calendar" ? "month" : s.view);
const days = () =>
  datesBetween(
    selection().start,
    selection().end,
    s.tab === "calendar" || s.weekends,
  );
const assignment = (person, date) =>
  s.data.assignments.find(
    (a) => a.personnel_id === person && a.work_date === date,
  );
const eventBy = (id) => s.data.events.find((e) => e.id === id);
const crewFor = (id) =>
  !id
    ? []
    : s.data.assignments
        .filter((a) => a.event_id === id)
        .map((a) => s.data.personnel.find((p) => p.id === a.personnel_id))
        .filter(Boolean);
const visiblePeople = () =>
  s.data.personnel
    .filter(
      (p) =>
        (p.active ||
          s.data.assignments.some(
            (a) =>
              a.personnel_id === p.id &&
              a.work_date >= selection().start &&
              a.work_date <= selection().end,
          )) &&
        (s.tab === "calendar" || !s.filter || p.id === s.filter) &&
        (s.tab === "calendar" ||
          !s.query ||
          `${p.name} ${p.role_label}`.toLowerCase().includes(s.query)),
    )
    .sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
    );
const visibleEvents = () =>
  s.data.events
    .filter(
      (e) =>
        e.event_date >= selection().start && e.event_date <= selection().end,
    )
    .sort(
      (a, b) =>
        a.event_date.localeCompare(b.event_date) ||
        a.call_time.localeCompare(b.call_time),
    );
const formFoot = (label) =>
  `<p id="formError" class="form-error form-full" role="alert" hidden></p><div class="form-actions form-full"><button type="button" class="button outline" data-close>Cancel</button><button type="submit" class="button primary">${label}</button></div>`;
const field = (label, name, value = "", type = "text", extra = "") =>
  `<label>${label}<input name="${name}" type="${type}" value="${h(value)}" ${extra}></label>`;
const codeOptions = (selected = "", allowMBD = true) =>
  `<option value="">— Unassigned (clear this cell)</option>` +
  ["AM", "PM", "MBD", "OFF", "LEAVE", "OFFICE", "TRAINING"]
    .filter((k) => allowMBD || k !== "MBD")
    .map(
      (k) =>
        `<option value="${k}" ${dutyGroup(selected) === k ? "selected" : ""}>${k}</option>`,
    )
    .join("");
const companionSection = (personId, date, code) =>
  ["AM", "PM"].includes(dutyGroup(code))
    ? `<section class="form-full"><h3>Companions on the ${dutyGroup(code)} shift</h3>${companionsMarkup(shiftCompanions(s.data, personId, date, code))}</section>`
    : "";
function showError(error) {
  $("errorBanner").textContent = error.message || String(error);
  $("errorBanner").hidden = false;
}
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 4500);
}
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openDialog(title, body) {
  if (s.saving) return;
  $("dialogTitle").textContent = title;
  $("dialogBody").innerHTML = body;
  if (!$("mainDialog").open) $("mainDialog").showModal();
  $("dialogBody").querySelector("input,select,textarea,button")?.focus();
}
function closeDialog() {
  if (!s.saving) $("mainDialog").close();
}
function adminUI() {
  document
    .querySelectorAll(".admin-only")
    .forEach((el) => (el.hidden = !s.admin));
  $("loginButton").hidden = s.admin;
  $("logoutButton").hidden = !s.admin;
  $("footerMode").textContent = s.admin
    ? demo
      ? "Demo administrator · Local edits"
      : "Administrator · Changes recorded"
    : "Public viewing · Admin editing";
  $("rosterHint").textContent = s.admin
    ? "Click a cell to edit. Hover for details and companions. ⚠ Reassign means an event was cancelled."
    : "Hover or tap a duty to view event details or shift companions. ⚠ Reassign means an event was cancelled.";
  if (!s.admin && s.tab === "personnel") s.tab = "roster";
}
function render() {
  adminUI();
  if (s.filter && !s.data.personnel.some((p) => p.id === s.filter))
    s.filter = "";
  const effectiveView = s.tab === "calendar" ? "month" : s.view;
  document.body.classList.toggle("calendar-view", s.tab === "calendar");
  document.querySelector(".segments").hidden = s.tab === "calendar";
  $("printButton").textContent =
    s.tab === "calendar" ? "Print calendar" : "Print roster";
  const p = selection(),
    ds = days(),
    people = visiblePeople();
  $("periodTitle").textContent =
    effectiveView === "week"
      ? `${formatDate(p.start, { day: "numeric", month: "short" })} – ${formatDate(p.end)}`
      : formatDate(p.start, { month: "long", year: "numeric" });
  $("periodSubtitle").textContent =
    `${effectiveView === "first" ? "Days 1–15" : effectiveView === "second" ? "Days 16–" + p.end.slice(-2) : effectiveView === "week" ? "Monday–Sunday" : "Whole month"} · Philippine time (UTC+8)`;
  $("monthPicker").value = s.anchor.slice(0, 7);
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("selected", b.dataset.view === s.view);
    b.setAttribute("aria-pressed", b.dataset.view === s.view);
  });
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === s.tab);
    b.setAttribute("aria-current", b.dataset.tab === s.tab ? "page" : "false");
  });
  for (const tab of [
    "roster",
    "calendar",
    "events",
    "changes",
    "balance",
    "personnel",
  ])
    $(tab + "Panel").hidden = s.tab !== tab;
  $("personFilter").innerHTML =
    '<option value="">All personnel</option>' +
    s.data.personnel
      .filter((p) => p.active || p.id === s.filter)
      .map((p) => `<option value="${h(p.id)}">${h(p.name)}</option>`)
      .join("");
  if (!s.data.personnel.some((p) => p.id === s.filter)) s.filter = "";
  $("personFilter").value = s.filter;
  $("legend").innerHTML = Object.entries(CODES)
    .map(
      ([k, v]) =>
        `<span><i class="legend-dot ${CLASSES[k]}"></i>${h(k)} <small>${h(v)}</small></span>`,
    )
    .join("");
  const selected = s.data.assignments.filter(
    (a) =>
      ds.includes(a.work_date) && people.some((p) => p.id === a.personnel_id),
  );
  const counts = {
    am: selected.filter((a) => a.code.startsWith("AM")).length,
    pm: selected.filter((a) => a.code.startsWith("PM")).length,
    mbd: selected.filter((a) => a.code === "MBD").length,
  };
  $("stats").innerHTML = [
    [people.length, "Personnel shown", "Across the selected roster"],
    [
      counts.am,
      "AM assignments",
      "Testing, component, labelling & distribution",
    ],
    [counts.pm, "PM assignments", "Afternoon duties"],
    [
      counts.mbd,
      "MBD assignments",
      visibleEvents().filter((e) => e.status !== "cancelled").length +
        " events in this period",
    ],
  ]
    .map(
      ([n, t, c]) =>
        `<article class="stat"><p>${t}</p><strong>${n}</strong><small>${c}</small></article>`,
    )
    .join("");
  $("rosterTable").style.minWidth = Math.max(720, 180 + ds.length * 64) + "px";
  $("rosterTable").innerHTML =
    `<caption class="visually-hidden">Personnel assignments, ${h(p.start)} to ${h(p.end)}</caption><thead><tr><th scope="col" class="person-col">Personnel <small>${people.length} team members</small></th>${ds.map((d) => `<th scope="col" class="${[0, 6].includes(parseDate(d).getUTCDay()) ? "weekend " : ""}${d === today() ? "today" : ""}"><strong>${+d.slice(-2)}</strong><small>${formatDate(d, { weekday: "short" })}</small></th>`).join("")}</tr></thead><tbody>${
      people.length
        ? people
            .map(
              (person) =>
                `<tr><th scope="row" class="person-col"><strong>${h(person.name)}</strong><small>${h(person.role_label)}${person.active ? "" : " · Archived"}</small></th>${ds
                  .map((d) => {
                    const a = assignment(person.id, d),
                      e = a?.event_id ? eventBy(a.event_id) : null;
                    const clickable = s.admin || Boolean(a);
                    return `<td class="${d === today() ? "today" : ""}"><button class="shift ${a ? CLASSES[a.code] : "empty"} ${clickable ? "" : "readonly"}" data-person="${person.id}" data-date="${d}" ${clickable ? "" : "disabled"} title="${h(assignmentTooltip(a, e, person, s.data))}" data-tooltip="${h(assignmentTooltip(a, e, person, s.data))}" aria-label="${h(person.name + ", " + formatDate(d) + ", " + (a?.code || "unassigned"))}"><strong>${h(a?.code === "CANCELLED" ? "⚠ Reassign" : a?.code || "—")}</strong>${a?.description ? `<small>${h(a.description)}</small>` : ""}</button></td>`;
                  })
                  .join("")}</tr>`,
            )
            .join("")
        : `<tr><td colspan="${ds.length + 1}" class="empty-state">${s.data.personnel.length ? "No personnel match your filter." : s.admin ? "Add personnel in the Personnel tab to begin." : "No personnel have been added yet."}</td></tr>`
    }</tbody>`;
  $("rosterTable").insertAdjacentHTML(
    "beforeend",
    `<tfoot><tr><th class="person-col" scope="row">Staffing counts<small>Personnel shown</small></th>${ds
      .map((d) => {
        const rows = selected.filter((a) => a.work_date === d);
        return `<td class="coverage"><span>AM ${rows.filter((a) => a.code.startsWith("AM")).length}</span><span>PM ${rows.filter((a) => a.code.startsWith("PM")).length} · MBD ${rows.filter((a) => a.code === "MBD").length}</span></td>`;
      })
      .join("")}</tr></tfoot>`,
  );
  $("eventsCount").textContent = visibleEvents().length;
  renderEvents();
  renderChanges();
  renderBalance(people, ds);
  renderPersonnel();
  renderCalendar();
  $("lastSync").textContent = s.sync
    ? "Updated " +
      new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(s.sync) +
      " PHT"
    : "Not synced yet";
  document.querySelector(".print-heading h2").textContent =
    config.organization || "Northern Mindanao Regional Blood Center";
  $("printPeriod").textContent =
    `${formatDate(p.start)} – ${formatDate(p.end)}${s.filter ? " · " + (s.data.personnel.find((p) => p.id === s.filter)?.name || "") : ""}${!s.weekends ? " · Weekdays only" : ""}${demo ? " · DEMO SCHEDULE" : ""}`;
  updateNotice();
}
function renderCalendar() {
  const month = s.anchor.slice(0, 7);
  if (s.calendarDate.slice(0, 7) !== month)
    s.calendarDate = today().slice(0, 7) === month ? today() : month + "-01";
  const model = calendarModel(s.data);
  const day = model.day(s.calendarDate);
  const focusedDate = document.activeElement?.dataset?.calendarDay;
  $("calendarGrid").innerHTML = monthMarkup(
    model,
    s.anchor,
    s.calendarDate,
    s.calendarNames,
  );
  $("calendarGrid").setAttribute(
    "aria-label",
    "Dates in " + formatDate(month + "-01", { month: "long", year: "numeric" }),
  );
  $("calendarDayTitle").textContent = formatDate(s.calendarDate, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  $("calendarDayCounts").innerHTML =
    `<span>${day.duty.length} on duty</span><span>AM ${day.counts.AM}</span><span>PM ${day.counts.PM}</span><span>MBD ${day.counts.MBD}</span><span>${day.unassigned} unassigned</span>${day.rows.some((r) => r.assignment?.code === "CANCELLED") ? `<span class="reassign-count">⚠ ${day.rows.filter((r) => r.assignment?.code === "CANCELLED").length} need reassignment</span>` : ""}`;
  $("calendarDayEvents").innerHTML = dayEventsMarkup(day);
  $("calendarDayPersonnel").innerHTML = dayPersonnelMarkup(
    model,
    day,
    s.calendarDuty,
    s.admin,
  );
  $("calendarDutyFilter").value = s.calendarDuty;
  $("calendarNamesToggle").checked = s.calendarNames;
  $("calendarPrintOrg").textContent =
    config.organization || "Northern Mindanao Regional Blood Center";
  $("calendarPrintMonth").textContent =
    formatDate(month + "-01", { month: "long", year: "numeric" }) +
    (demo ? " · DEMO SCHEDULE" : "");
  if (focusedDate && s.tab === "calendar")
    $("calendarGrid")
      .querySelector(`[data-calendar-day="${focusedDate}"]`)
      ?.focus({ preventScroll: true });
}
function renderEvents() {
  const events = visibleEvents();
  $("eventList").innerHTML = events.length
    ? events
        .map(
          (e) =>
            `<article class="event-card"><div class="event-top"><span class="eyebrow">${h(formatDate(e.event_date, { day: "numeric", month: "short", weekday: "short" }))}</span><span class="status ${h(e.status)}">${h(e.status)}</span></div><h3>${h(e.title)}</h3><p class="event-location">${h(e.location)}</p><div class="event-facts"><span><small>Call time</small><strong>${h(e.call_time.slice(0, 5))} PHT</strong></span><span><small>Expected donors</small><strong>${e.expected_donors}</strong></span></div><p class="crew-line"><strong>Team</strong> ${h(
              orderedPeople(crewFor(e.id))
                .map((p) => p.name + " (" + roleOf(p) + ")")
                .join(", ") || "Not assigned yet",
            )}</p><div class="event-actions"><button class="button outline" data-event="${e.id}">View details →</button>${s.admin ? `<button class="button quiet" data-edit-event="${e.id}">Edit</button>` : ""}</div></article>`,
        )
        .join("")
    : '<p class="empty-state">No MBD events in this period.</p>';
}
function displayValue(key, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "driver_personnel_id")
    return s.data.personnel.find((p) => p.id === value)?.name || "Driver";
  if (key === "event_id") return eventBy(value)?.title || "Linked MBD event";
  if (key === "personnel_id")
    return s.data.personnel.find((p) => p.id === value)?.name || "Personnel";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
function renderChanges() {
  const labels = {
    name: "Name",
    role_label: "Role",
    active: "Active",
    sort_order: "Display order",
    title: "Event",
    event_date: "Date",
    location: "Location",
    call_time: "Call time",
    end_time: "End time",
    expected_donors: "Expected donors",
    contact_person: "Contact",
    transport: "Transport",
    driver_personnel_id: "Driver",
    driver_mode: "Driver source",
    other_driver_name: "Other driver",
    rpo_number: "RPO number",
    vehicle_name: "Vehicle",
    vehicle_details: "Vehicle details",
    assignment_code: "Event duty",
    notes: "Details",
    status: "Status",
    personnel_id: "Personnel",
    work_date: "Date",
    code: "Assignment",
    description: "Description",
    event_id: "MBD event",
  };
  const changes = s.data.changes;
  $("changesCount").textContent = changes.length >= 50 ? "50+" : changes.length;
  $("changeList").innerHTML = changes.length
    ? changes
        .map((c) => {
          const fields = Object.keys(labels).filter(
            (k) =>
              JSON.stringify(c.before_data?.[k]) !==
              JSON.stringify(c.after_data?.[k]),
          );
          return `<article class="change-item"><span class="change-dot"></span><div><h3>${h(c.summary)}</h3><small>${h(c.actor_label)} · ${h(new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(c.occurred_at)))} PHT</small>${fields.length ? `<details><summary>View changed details</summary><dl class="diff-list">${fields.map((k) => `<div><dt>${labels[k]}</dt><dd>${h(displayValue(k, c.before_data?.[k]))} → ${h(displayValue(k, c.after_data?.[k]))}</dd></div>`).join("")}</dl></details>` : ""}</div></article>`;
        })
        .join("")
    : '<p class="empty-state">No changes have been recorded yet.</p>';
  $("loadOlderChanges").hidden = changes.length < 50;
}
function renderBalance(people, ds) {
  const groups = [
    "AM/T",
    "AM/C",
    "AM/L",
    "AM/D",
    "PM/T",
    "PM/C",
    "CANCELLED",
    "AM",
    "PM",
    "MBD",
    "OFF",
    "LEAVE",
    "OFFICE",
    "TRAINING",
  ];
  $("balanceTable").innerHTML =
    `<thead><tr><th>Personnel</th>${groups.map((k) => `<th>${k}</th>`).join("")}<th>Unassigned</th></tr></thead><tbody>${people
      .map((p) => {
        const list = s.data.assignments.filter(
          (a) => a.personnel_id === p.id && ds.includes(a.work_date),
        );
        return `<tr><th>${h(p.name)}</th>${groups.map((k) => `<td>${list.filter((a) => a.code === k).length || "—"}</td>`).join("")}<td>${ds.length - list.length}</td></tr>`;
      })
      .join("")}</tbody>`;
}
function renderPersonnel() {
  $("personnelList").innerHTML = s.data.personnel.length
    ? [...s.data.personnel]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(
          (p) =>
            `<article class="personnel-item"><div><h3>${h(p.name)}</h3><p>${h(p.role_label || "No role listed")} · ${p.active ? "Active" : "Archived"}</p></div><button class="button outline" data-edit-person="${p.id}">Edit</button></article>`,
        )
        .join("")
    : '<p class="empty-state">Add your first personnel record.</p>';
}
function updateNotice() {
  const latest = String(s.data.changes[0]?.id || 0);
  let seen = localStorage.getItem(seenKey);
  if (seen === null) {
    localStorage.setItem(seenKey, latest);
    seen = latest;
  }
  let unseen = [];
  try {
    unseen = s.data.changes.filter((c) => BigInt(c.id) > BigInt(seen));
  } catch {
    localStorage.setItem(seenKey, latest);
  }
  $("updatesBanner").hidden = !unseen.length;
  $("updatesText").textContent =
    `${unseen.length >= 50 ? "50+" : unseen.length} new schedule ${unseen.length === 1 ? "change" : "changes"} since you last marked them as seen.`;
}
function markSeen() {
  localStorage.setItem(seenKey, String(s.data.changes[0]?.id || 0));
  updateNotice();
}
async function refresh(quiet = false) {
  if (!store) return;
  const epoch = ++s.epoch;
  const p = selection();
  const start = [s.anchor.slice(0, 7) + "-01", p.start].sort()[0],
    end = [monthEnd(s.anchor), p.end].sort().at(-1);
  try {
    const data = await store.load(start, end);
    if (epoch !== s.epoch) return;
    s.data = data;
    s.sync = new Date();
    $("errorBanner").hidden = true;
    $("connectionBadge").textContent = demo
      ? "Demo · local data"
      : "Live · public roster";
    $("connectionBadge").classList.remove("offline");
    render();
    if (!quiet) toast("Schedule refreshed.");
  } catch (error) {
    if (epoch !== s.epoch) return;
    $("connectionBadge").textContent = "Connection unavailable";
    $("connectionBadge").classList.add("offline");
    showError(
      Error(
        "Could not refresh the roster. " +
          (error.message || "Check your connection and configuration."),
      ),
    );
  }
}
async function save(form, name, args) {
  if (!s.admin) return;
  s.saving = true;
  const buttons = form.querySelectorAll("button");
  buttons.forEach((b) => (b.disabled = true));
  $("closeDialog").disabled = true;
  try {
    await store.write(name, args);
    s.saving = false;
    $("mainDialog").close();
    await refresh(true);
    toast("Saved. The change history has been updated.");
  } catch (error) {
    const el = $("formError");
    el.hidden = false;
    el.textContent =
      error.code === "40001"
        ? "Another edit changed this record. Close this editor, refresh, and reopen it before saving."
        : error.message || String(error);
  } finally {
    s.saving = false;
    buttons.forEach((b) => (b.disabled = false));
    $("closeDialog").disabled = false;
  }
}
function assignmentForm(personId, date) {
  if (!s.admin) return;
  const person = s.data.personnel.find((p) => p.id === personId),
    a = assignment(personId, date);
  const available = s.data.events.filter(
    (e) => e.event_date === date && e.status !== "cancelled",
  );
  openDialog(
    `${person.name} · ${formatDate(date)}`,
    `<form id="assignmentForm" class="form-grid">${a?.code === "CANCELLED" ? '<p class="driver-warning form-full">⚠ The linked event was cancelled. Select a new duty to replace this warning.</p>' : ""}<label class="form-full">Assignment<select name="code">${codeOptions(a?.code)}</select></label><label class="form-full" id="eventSelectField">Linked activity<select name="event_id"></select><small>MBD requires an event. Training, Office, and Testing may be linked to a matching activity.</small></label><label class="form-full">Duty description<textarea name="description" maxlength="500" rows="2">${h(a?.description)}</textarea></label><div id="shiftCompanions" class="form-full"></div>${formFoot("Save assignment")}</form>`,
  );
  const form = $("assignmentForm");
  form.elements.code.required = a?.code === "CANCELLED";
  let getCode;
  const toggle = () => {
    const code =
      form.elements.sub_code?.disabled === false
        ? form.elements.sub_code.value
        : form.elements.code.value;
    const choices = available.filter((e) => eventDuty(e) === code);
    $("eventSelectField").hidden = code !== "MBD" && !choices.length;
    form.elements.event_id.required = code === "MBD";
    const previous = form.elements.event_id.value || a?.event_id;
    form.elements.event_id.innerHTML =
      '<option value="">' +
      (code === "MBD" ? "Choose an event" : "No linked activity") +
      "</option>" +
      choices
        .map(
          (e) =>
            `<option value="${h(e.id)}" ${e.id === previous ? "selected" : ""}>${h(e.title)} · ${h(e.location)}</option>`,
        )
        .join("");
    $("shiftCompanions").innerHTML = companionSection(personId, date, code);
  };
  getCode = setupDutyPicker(form, a?.code, toggle);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const code = getCode();
    save(form, "scheduler_apply_assignments", {
      p_entries: [
        {
          personnel_id: personId,
          work_date: date,
          code,
          description: form.elements.description.value,
          event_id:
            code && !$("eventSelectField").hidden
              ? form.elements.event_id.value || null
              : null,
          expected_version: a?.version || 0,
        },
      ],
      p_reason: "Assignment updated automatically.",
    });
  });
}
function personnelForm(id = null) {
  if (!s.admin) return;
  const p = s.data.personnel.find((p) => p.id === id);
  openDialog(
    p ? "Edit personnel" : "Add personnel",
    `<form id="personnelForm" class="form-grid">${field("Personnel name", "name", p?.name, "text", 'required maxlength="120"')}${`<label>Role / designation<select name="role_label" required>${p && !ROLES.includes(roleOf(p)) ? `<option value="" disabled selected>Choose designation (previous: ${h(p.role_label)})</option>` : ""}${ROLES.map((r) => `<option ${roleOf(p) === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>`}${field("Display order", "sort_order", p?.sort_order ?? s.data.personnel.length, "number", 'required min="0" max="100000" step="1"')}<label class="checkbox-label"><input type="checkbox" name="active" ${p?.active !== false ? "checked" : ""}> Active personnel</label><p class="public-note form-full">Archiving hides a person from new assignments and preserves their existing schedules and history.</p>${formFoot(p ? "Save personnel" : "Add personnel")}</form>`,
  );
  const form = $("personnelForm");
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    save(form, "scheduler_save_personnel", {
      p_id: id,
      p_expected_version: p?.version || 0,
      p_name: form.elements.name.value,
      p_role_label: form.elements.role_label.value,
      p_sort_order: Number(form.elements.sort_order.value),
      p_active: form.elements.active.checked,
      p_reason: "Personnel updated automatically.",
    });
  });
}
function eventDetails(id, personId = null, date = null) {
  const e = eventBy(id);
  if (!e) return;
  const crew = crewFor(id);
  openDialog(
    "Activity details",
    `<div class="detail-hero"><span class="status ${h(e.status)}">${h(e.status)}</span><h3>${h(e.title)}</h3><p>${h(e.location)}</p><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}" target="_blank" rel="noopener noreferrer">Open location in Maps ↗</a></div>${e.status === "cancelled" ? '<p class="driver-warning">⚠ Cancelled. Personnel still marked ⚠ Reassign need a new assignment.</p>' : ""}${needsDriver(e, s.data) ? '<p class="driver-warning" role="status">⚠ No driver confirmed. Driver arrangement is pending.</p>' : ""}<dl class="detail-grid"><div><dt>Event date</dt><dd>${h(formatDate(e.event_date))}</dd></div><div><dt>Call time · Philippine time</dt><dd>${h(e.call_time.slice(0, 5))} PHT${e.end_time ? " · Ends " + h(e.end_time.slice(0, 5)) : ""}</dd></div><div><dt>Expected donors</dt><dd>${e.expected_donors}</dd></div><div><dt>RPO number</dt><dd>${h(e.rpo_number || "Not entered")}</dd></div><div><dt>Vehicle</dt><dd>${h(e.vehicle_name || "For arrangement")}<p>${h(e.vehicle_details || "")}</p></dd></div><div><dt>Driver</dt><dd>${h(driverLabel(e, s.data.personnel))}</dd></div><div><dt>Transport / meeting point</dt><dd>${h(e.transport || "To be confirmed")}</dd></div><div><dt>Companions</dt><dd>${companionsMarkup(crew, e)}</dd></div><div><dt>Contact person</dt><dd>${h(e.contact_person || "To be confirmed")}</dd></div></dl><div class="detail-notes"><h4>Additional details</h4><p>${h(e.notes || "No additional instructions.")}</p></div><div class="form-actions"><button class="button outline" id="calendarDownload">Add to calendar</button>${s.admin ? `<button class="button primary" data-edit-event="${e.id}">Edit event & team</button>${personId ? '<button class="button outline" id="editMbdCell">Change this assignment</button>' : ""}` : ""}</div>`,
  );
  $("calendarDownload").onclick = () =>
    download(
      calendarFile(
        e,
        orderedPeople(crew)
          .map((p) => `${p.name} (${roleOf(p)})`)
          .concat(
            e.driver_mode === "other"
              ? [`${e.other_driver_name || "For arrangement"} (Driver)`]
              : [],
          ),
      ),
      "event-" + e.event_date + ".ics",
      "text/calendar",
    );
  if (s.admin && personId)
    $("editMbdCell").onclick = () => assignmentForm(personId, date);
}
function eventForm(id = null, prefillDate = null) {
  if (!s.admin) return;
  const e = eventBy(id),
    crew = crewFor(id).map((p) => p.id),
    date = e?.event_date || prefillDate || selection().start;
  const catalog = s.data.catalog || [];
  const titles = [
    ...new Set([
      ...TITLES,
      ...catalog.filter((c) => c.kind === "title").map((c) => c.name),
      ...s.data.events.map((x) => x.title),
    ]),
  ];
  const vehicles = [
    ...new Set([
      ...catalog.filter((c) => c.kind === "vehicle").map((c) => c.name),
      ...s.data.events.map((x) => x.vehicle_name).filter(Boolean),
    ]),
  ];
  const drivers = s.data.personnel.filter(
    (p) =>
      (p.active || p.id === e?.driver_personnel_id) && roleOf(p) === "Driver",
  );
  openDialog(
    e ? "Edit activity & team" : "Add MBD event / activity",
    `<form id="eventForm" class="form-grid"><label>Event title<select name="title_choice">${titles.map((t) => `<option value="${h(t)}" ${t === (e?.title || TITLES[0]) ? "selected" : ""}>${h(t)}</option>`).join("")}<option value="__other">Other — add a title</option></select></label>${field("New event title", "title", "", "text", 'maxlength="160"')}${field("Event date", "event_date", date, "date", "required")}${field("Location / venue", "location", e?.location, "text", 'required maxlength="300"')}${field("Call time · Philippine time", "call_time", e?.call_time?.slice(0, 5) || "07:00", "time", "required")}${field("End time (optional)", "end_time", e?.end_time?.slice(0, 5), "time")}${field("Expected donors", "expected_donors", e?.expected_donors ?? 0, "number", 'required min="0" max="100000" step="1"')}${field("RPO number", "rpo_number", e?.rpo_number, "text", 'maxlength="120"')}<label>Vehicle<select name="vehicle_choice"><option value="">For arrangement / no vehicle</option>${vehicles.map((v) => `<option value="${h(v)}" ${v === e?.vehicle_name ? "selected" : ""}>${h(v)}</option>`).join("")}<option value="__other">Other — add a vehicle</option></select></label>${field("New vehicle name", "vehicle_name", "", "text", 'maxlength="160"')}<label class="form-full">Vehicle details<textarea name="vehicle_details" rows="2" maxlength="1000">${h(e?.vehicle_details)}</textarea></label><label>Driver from personnel<select name="driver_personnel_id"><option value="">For arrangement — no driver selected</option>${drivers.map((p) => `<option value="${h(p.id)}" ${p.id === e?.driver_personnel_id ? "selected" : ""}>${h(p.name)} · Driver${p.active ? "" : " (archived)"}</option>`).join("")}</select></label><label class="checkbox-label"><input type="checkbox" name="other_driver" ${e?.driver_mode === "other" ? "checked" : ""}> Other driver / arrange externally</label>${field("Other driver's name (leave blank if pending)", "other_driver_name", e?.other_driver_name, "text", 'maxlength="120"')}<p id="driverWarning" class="driver-warning form-full" role="status"></p>${field("Contact person (public)", "contact_person", e?.contact_person, "text", 'maxlength="160"')}${field("Transport / meeting point", "transport", e?.transport, "text", 'maxlength="300"')}<label>Status<select name="status">${["planned", "confirmed", "cancelled"].map((v) => `<option ${e?.status === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="form-full">Additional details<textarea name="notes" rows="3" maxlength="2000">${h(e?.notes)}</textarea></label><fieldset class="form-full"><legend>Companions / assigned personnel</legend><p class="muted small">The selected personnel driver is included automatically. Other duties must be cleared first. Cancellation leaves a warning until each person is reassigned.</p><div class="crew-picker">${
      orderedPeople(
        s.data.personnel.filter(
          (p) => (p.active || crew.includes(p.id)) && roleOf(p) !== "Driver",
        ),
      )
        .map(
          (p) =>
            `<label class="checkbox-label"><input type="checkbox" name="crew" value="${p.id}" ${crew.includes(p.id) ? "checked" : ""}> ${h(p.name)} · ${h(roleOf(p))}${p.active ? "" : " (archived)"}</label>`,
        )
        .join("") || "Add personnel to assign a team."
    }</div></fieldset>${formFoot("Save event & team")}</form>`,
  );
  const form = $("eventForm"),
    f = form.elements;
  const titleToggle = () => {
    const other = f.title_choice.value === "__other";
    f.title.closest("label").hidden = !other;
    f.title.required = other;
  };
  const vehicleToggle = (changed = false) => {
    const other = f.vehicle_choice.value === "__other";
    f.vehicle_name.closest("label").hidden = !other;
    f.vehicle_name.required = other;
    if (changed)
      f.vehicle_details.value =
        catalog.find(
          (c) => c.kind === "vehicle" && c.name === f.vehicle_choice.value,
        )?.details ||
        s.data.events.find((x) => x.vehicle_name === f.vehicle_choice.value)
          ?.vehicle_details ||
        "";
  };
  const driverToggle = () => {
    const external = f.other_driver.checked;
    f.driver_personnel_id.disabled = external;
    f.other_driver_name.closest("label").hidden = !external;
    const missing = external
      ? !f.other_driver_name.value.trim()
      : !f.driver_personnel_id.value;
    $("driverWarning").hidden = !missing;
    $("driverWarning").textContent =
      "⚠ No driver confirmed. You may save while driver arrangements are pending.";
  };
  f.title_choice.onchange = titleToggle;
  f.vehicle_choice.onchange = () => vehicleToggle(true);
  f.other_driver.onchange = driverToggle;
  f.driver_personnel_id.onchange = driverToggle;
  f.other_driver_name.oninput = driverToggle;
  titleToggle();
  vehicleToggle();
  driverToggle();
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(form)),
      p_event = {};
    for (const k of [
      "event_date",
      "location",
      "call_time",
      "end_time",
      "contact_person",
      "transport",
      "notes",
      "status",
      "rpo_number",
      "vehicle_details",
    ])
      p_event[k] = v[k];
    p_event.title =
      f.title_choice.value === "__other"
        ? f.title.value.trim()
        : f.title_choice.value;
    p_event.vehicle_name =
      f.vehicle_choice.value === "__other"
        ? f.vehicle_name.value.trim()
        : f.vehicle_choice.value;
    p_event.expected_donors = Number(v.expected_donors);
    p_event.driver_mode = f.other_driver.checked ? "other" : "personnel";
    p_event.driver_personnel_id = f.other_driver.checked
      ? null
      : f.driver_personnel_id.value || null;
    p_event.other_driver_name = f.other_driver.checked
      ? f.other_driver_name.value.trim()
      : "";
    p_event.assignment_code = eventDuty({ title: p_event.title });
    const selected = new Set(new FormData(form).getAll("crew"));
    if (p_event.driver_personnel_id) selected.add(p_event.driver_personnel_id);
    save(form, "scheduler_save_event", {
      p_id: id,
      p_expected_version: e?.version || 0,
      p_event,
      p_crew: [...selected],
      p_reason: "Activity and team updated automatically.",
    });
  });
}
function shiftDetails(personId, date) {
  const p = s.data.personnel.find((p) => p.id === personId),
    a = assignment(personId, date);
  if (!a) return;
  openDialog(
    `${p.name} · ${formatDate(date)}`,
    `<div class="detail-hero"><h3>${h(CODES[a.code] || a.code)}</h3><p>${h(a.description || "No additional instructions.")}</p></div>${companionSection(personId, date, a.code) || "<p>No shift companion list for this duty.</p>"}`,
  );
}
function bulkForm() {
  if (!s.admin) return;
  const p = selection(),
    snapshot = structuredClone(s.data.assignments),
    people = s.data.personnel.filter((p) => p.active);
  openDialog(
    "Assign a date range",
    `<form id="bulkForm" class="form-grid">${field("From", "from", p.start, "date", `required min="${p.start}" max="${p.end}"`)}${field("Through", "through", p.end, "date", `required min="${p.start}" max="${p.end}"`)}<label>Assignment<select name="code" required>${codeOptions("", false).replace('<option value="">— Unassigned (clear this cell)</option>', '<option value="">Choose a duty</option>')}</select></label><label>Duty description<input name="description" maxlength="500"></label><label class="checkbox-label"><input type="checkbox" name="weekdays" checked> Weekdays only</label><label class="checkbox-label"><input type="checkbox" name="replace"> Replace existing duties</label><fieldset class="form-full"><legend>Personnel</legend><div class="crew-picker">${people.map((p) => `<label class="checkbox-label"><input type="checkbox" name="people" value="${p.id}" ${p.id === s.filter ? "checked" : ""}> ${h(p.name)}</label>`).join("")}</div></fieldset><p class="public-note form-full">Existing duties are skipped unless replacement is checked. MBD teams are assigned from the event editor. The whole range saves together, or nothing is changed if a conflict is found.</p>${formFoot("Apply assignments")}</form>`,
  );
  const form = $("bulkForm");
  const getCode = setupDutyPicker(form);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const fd = new FormData(form),
      ids = fd.getAll("people");
    const error = (msg) => {
      $("formError").hidden = false;
      $("formError").textContent = msg;
    };
    if (!ids.length) return error("Select at least one personnel record.");
    if (fd.get("from") > fd.get("through"))
      return error("The start date must be before the end date.");
    if (fd.get("from") < p.start || fd.get("through") > p.end)
      return error("Keep this range within the selected period.");
    const dates = datesBetween(
      fd.get("from"),
      fd.get("through"),
      !fd.has("weekdays"),
    );
    const entries = [];
    for (const id of ids)
      for (const date of dates) {
        const old = snapshot.find(
          (a) => a.personnel_id === id && a.work_date === date,
        );
        if (old && old.code !== "CANCELLED" && !fd.has("replace")) continue;
        entries.push({
          personnel_id: id,
          work_date: date,
          code: getCode(),
          description: fd.get("description"),
          event_id: null,
          expected_version: old?.version || 0,
        });
      }
    if (!entries.length)
      return error(
        "No unassigned cells in this selection. Select another range or enable replacement.",
      );
    if (entries.length > 5000)
      return error("Select a smaller range (at most 5,000 assignments).");
    save(form, "scheduler_apply_assignments", {
      p_entries: entries,
      p_reason: "Assignments updated automatically.",
    });
  });
}
function loginDialog() {
  openDialog(
    demo ? "Try the demo administrator" : "Administrator login",
    demo
      ? '<p class="public-note">This is a sample workspace. Demo edits are saved in this browser only and do not update Supabase.</p><button id="demoLogin" class="button primary">Try demo editing</button>'
      : `<form id="loginForm" class="form-grid">${field("Email", "email", "", "email", 'required autocomplete="username"')}${field("Password", "password", "", "password", 'required autocomplete="current-password"')}<p class="public-note form-full">Use an account approved by the project owner. Public schedule viewing does not require an account.</p>${formFoot("Sign in")}<button type="button" class="button quiet form-full" id="forgotPassword">Send password reset email</button></form>`,
  );
  if (demo) {
    $("demoLogin").onclick = () => {
      s.admin = true;
      closeDialog();
      render();
      toast("Demo editing enabled in this browser.");
    };
    return;
  }
  const form = $("loginForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const button = form.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const { error } = await client.auth.signInWithPassword({
        email: form.elements.email.value.trim(),
        password: form.elements.password.value,
      });
      if (error) throw error;
      const { data, error: roleError } = await client.rpc("scheduler_is_admin");
      if (roleError) throw roleError;
      if (!data) {
        await client.auth.signOut();
        throw Error(
          "This account is not an approved schedule administrator. Ask the project owner to grant access.",
        );
      }
      s.admin = true;
      closeDialog();
      render();
      toast("Administrator signed in.");
    } catch (e) {
      $("formError").hidden = false;
      $("formError").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  });
  $("forgotPassword").onclick = async () => {
    const email = form.elements.email.value.trim();
    if (!email) {
      $("formError").hidden = false;
      $("formError").textContent = "Enter your admin email first.";
      return;
    }
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + "/",
    });
    if (error) {
      $("formError").hidden = false;
      $("formError").textContent = error.message;
    } else toast("If the account exists, a password reset email will be sent.");
  };
}
function recoveryDialog() {
  openDialog(
    "Set a new administrator password",
    `<form id="recoveryForm" class="form-grid">${field("New password", "password", "", "password", 'required minlength="12" autocomplete="new-password"')}<p class="public-note form-full">Use at least 12 characters. This does not grant administrator privileges.</p>${formFoot("Update password")}</form>`,
  );
  $("recoveryForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const { error } = await client.auth.updateUser({
      password: ev.target.elements.password.value,
    });
    if (error) {
      $("formError").hidden = false;
      $("formError").textContent = error.message;
    } else {
      closeDialog();
      await authState();
      toast("Password updated.");
    }
  };
}
async function authState() {
  if (!client) return;
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session) {
    s.admin = false;
    render();
    return;
  }
  const { data, error } = await client.rpc("scheduler_is_admin");
  s.admin = !error && data === true;
  render();
}
function bind() {
  const tip = document.createElement("div");
  tip.className = "duty-tooltip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  const hide = () => (tip.hidden = true);
  const show = (target, x, y) => {
    if (!target?.dataset.tooltip) return hide();
    tip.textContent = target.dataset.tooltip;
    tip.hidden = false;
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - w - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(y + 14, innerHeight - h - 8)) + "px";
  };
  document.addEventListener("pointerover", (ev) => {
    if (ev.pointerType !== "touch")
      show(ev.target.closest("[data-tooltip]"), ev.clientX, ev.clientY);
  });
  document.addEventListener("pointerout", (ev) => {
    if (
      ev.target.closest("[data-tooltip]") &&
      !ev.target.closest("[data-tooltip]").contains(ev.relatedTarget)
    )
      hide();
  });
  document.addEventListener("focusin", (ev) => {
    const t = ev.target.closest("[data-tooltip]");
    if (t) {
      const r = t.getBoundingClientRect();
      show(t, r.left, r.bottom);
    }
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("click", hide);
  document.addEventListener("scroll", hide, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hide();
  });
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.tab) {
      s.tab = b.dataset.tab;
      render();
    }
    if (b.dataset.calendarDay) {
      s.calendarDate = b.dataset.calendarDay;
      renderCalendar();
      if (matchMedia("(max-width:650px)").matches) {
        $("calendarDayTitle").focus({ preventScroll: true });
        document
          .querySelector(".calendar-day-panel")
          .scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    if (b.dataset.view) {
      s.view = b.dataset.view;
      refresh(true);
    }
    if (b.dataset.event) eventDetails(b.dataset.event);
    if (b.dataset.editEvent) eventForm(b.dataset.editEvent);
    if (b.dataset.editPerson) personnelForm(b.dataset.editPerson);
    if (b.dataset.person) {
      const a = assignment(b.dataset.person, b.dataset.date);
      if (a?.event_id && a.code !== "CANCELLED")
        eventDetails(a.event_id, b.dataset.person, b.dataset.date);
      else if (s.admin) assignmentForm(b.dataset.person, b.dataset.date);
      else if (a?.event_id)
        eventDetails(a.event_id, b.dataset.person, b.dataset.date);
      else shiftDetails(b.dataset.person, b.dataset.date);
    }
    if (b.hasAttribute("data-close")) closeDialog();
  });
  $("closeDialog").onclick = closeDialog;
  $("mainDialog").addEventListener("cancel", (ev) => {
    if (s.saving) ev.preventDefault();
  });
  $("loginButton").onclick = loginDialog;
  $("logoutButton").onclick = async () => {
    try {
      if (client) {
        const { error } = await client.auth.signOut();
        if (error) throw error;
      }
      s.admin = false;
      closeDialog();
      render();
      toast("Signed out. Public viewing remains available.");
    } catch (e) {
      showError(e);
    }
  };
  $("refreshButton").onclick = () => refresh();
  $("prevPeriod").onclick = () => {
    const next = movePeriod(
      s.anchor,
      s.tab === "calendar" ? "month" : s.view,
      -1,
    );
    if (s.tab === "calendar") s.anchor = next.anchor;
    else Object.assign(s, next);
    refresh(true);
  };
  $("nextPeriod").onclick = () => {
    const next = movePeriod(
      s.anchor,
      s.tab === "calendar" ? "month" : s.view,
      1,
    );
    if (s.tab === "calendar") s.anchor = next.anchor;
    else Object.assign(s, next);
    refresh(true);
  };
  $("todayButton").onclick = () => {
    s.anchor = today();
    if (s.tab !== "calendar")
      s.view = +s.anchor.slice(-2) <= 15 ? "first" : "second";
    s.calendarDate = today();
    refresh(true);
  };
  $("monthPicker").onchange = (ev) => {
    if (!ev.target.value) return;
    s.anchor = ev.target.value + "-01";
    refresh(true);
  };
  $("weekendsToggle").onchange = (ev) => {
    s.weekends = ev.target.checked;
    render();
  };
  $("personFilter").onchange = (ev) => {
    s.filter = ev.target.value;
    localStorage.setItem("scheduler-person-filter", s.filter);
    render();
  };
  $("searchInput").oninput = (ev) => {
    s.query = ev.target.value.toLowerCase().trim();
    render();
  };
  $("calendarNamesToggle").onchange = (ev) => {
    s.calendarNames = ev.target.checked;
    renderCalendar();
  };
  $("calendarDutyFilter").onchange = (ev) => {
    s.calendarDuty = ev.target.value;
    renderCalendar();
  };
  $("calendarAddEvent").onclick = () => eventForm(null, s.calendarDate);
  $("bulkButton").onclick = bulkForm;
  $("addEventButton").onclick = () => eventForm();
  $("addPersonnelButton").onclick = () => personnelForm();
  $("markSeen").onclick = markSeen;
  $("viewUpdates").onclick = () => {
    s.tab = "changes";
    render();
  };
  $("loadOlderChanges").onclick = async () => {
    const b = $("loadOlderChanges");
    b.disabled = true;
    try {
      const older = await store.older(s.data.changes.at(-1)?.id || 0);
      const ids = new Set(s.data.changes.map((c) => String(c.id)));
      s.data.changes.push(...older.filter((c) => !ids.has(String(c.id))));
      renderChanges();
      if (older.length < 50) b.hidden = true;
    } catch (e) {
      showError(e);
    } finally {
      b.disabled = false;
    }
  };
  $("exportButton").onclick = () => {
    if (s.tab === "calendar") {
      download(
        "\ufeff" + csv(calendarExportRows(s.data, s.anchor)),
        "activity-calendar-" + s.anchor.slice(0, 7) + ".csv",
        "text/csv;charset=utf-8",
      );
      return;
    }
    const ds = days();
    const rows = [
      ["Personnel", "Role", ...ds],
      ...visiblePeople().map((p) => [
        p.name,
        p.role_label,
        ...ds.map((d) => {
          const a = assignment(p.id, d);
          return a
            ? [
                a.code,
                a.description,
                a.event_id ? eventBy(a.event_id)?.title : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : "Unassigned";
        }),
      ]),
    ];
    download(
      "\ufeff" + csv(rows),
      `roster-${selection().start}-${selection().end}.csv`,
      "text/csv;charset=utf-8",
    );
  };
  $("printButton").onclick = () => {
    if (s.tab !== "calendar") s.tab = "roster";
    render();
    window.print();
  };
  window.addEventListener("focus", () => refresh(true));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh(true);
  });
  window.addEventListener("storage", (e) => {
    if (demo && e.key === "nmrbc-demo-v1") refresh(true);
    if (e.key === seenKey) updateNotice();
  });
}
async function init() {
  bind();
  try {
    const url = (config.supabaseUrl || "").trim(),
      key = (config.supabasePublishableKey || "").trim();
    if (!url && !key) {
      demo = true;
      store = new DemoStore();
      $("modeBanner").hidden = false;
      $("modeBanner").textContent =
        "Demo workspace · Sample personnel and schedules. Edits are stored only in this browser. Add your Supabase settings in config.js to go live.";
    } else {
      if (!url || !key)
        throw Error(
          "Fill in both supabaseUrl and supabasePublishableKey in config.js.",
        );
      if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/i.test(url))
        throw Error("Use your HTTPS Supabase project URL in config.js.");
      let secret = key.startsWith("sb_secret_");
      if (key.split(".").length === 3) {
        try {
          secret ||=
            JSON.parse(
              atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
            ).role === "service_role";
        } catch {}
      }
      if (secret)
        throw Error(
          "Remove this secret/service-role key from config.js and rotate it in Supabase. Use a publishable key or legacy anon key.",
        );
      client = createClient(url, key);
      store = new LiveStore(client);
      client.auth.onAuthStateChange((event) => {
        setTimeout(
          () =>
            event === "PASSWORD_RECOVERY" ? recoveryDialog() : authState(),
          0,
        );
      });
      await authState();
    }
    $("connectionBadge").textContent = demo
      ? "Demo · local data"
      : "Connecting…";
    await refresh(true);
    timer = setInterval(
      () => {
        if (!document.hidden && !s.saving) refresh(true);
      },
      Math.min(300, Math.max(15, Number(config.pollSeconds) || 45)) * 1000,
    );
  } catch (e) {
    $("connectionBadge").textContent = "Setup required";
    $("loginButton").disabled = true;
    showError(e);
    render();
  }
}
init();
