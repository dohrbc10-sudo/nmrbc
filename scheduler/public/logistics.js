import { CODES, html as h } from "./core.js";
export const ROLES = ["MT", "HPO", "Driver", "MO", "Regular"];
export const ROLE_ORDER = ["MT", "HPO", "MO", "Regular", "Driver"];
export const TITLES = [
  "Training",
  "NMMC Testing",
  "Meeting",
];
export const DUTIES = { AM: ["AM/T", "AM/C", "AM/L", "AM/D"], PM: ["PM/T", "PM/C"] };
export function roleOf(p) {
  const r = (p?.role_label || "").trim();
  const known = ROLES.find((x) => x.toLowerCase() === r.toLowerCase());
  if (known) return known;
  if (/medical technologist|^rmt$|^technologist$/i.test(r)) return "MT";
  if (/health promotion|^hpo$/i.test(r)) return "HPO";
  if (/medical officer|^doctor$/i.test(r)) return "MO";
  if (/driver/i.test(r)) return "Driver";
  return r || "Regular";
}
export const dutyGroup = (code) =>
  code?.startsWith("AM") ? "AM" : code?.startsWith("PM") ? "PM" : code || "";
export const eventDuty = (e) =>
  e?.assignment_code ||
  (e?.title?.trim().toLowerCase() === "training"
    ? "TRAINING"
    : e?.title?.trim().toLowerCase() === "meeting"
      ? "OFFICE"
      : e?.title?.trim().toLowerCase() === "nmmc testing"
        ? "AM/T"
        : "MBD");
export function orderedPeople(people) {
  return [...people].sort(
    (a, b) =>
      (ROLE_ORDER.includes(roleOf(a)) ? ROLE_ORDER.indexOf(roleOf(a)) : 3) -
        (ROLE_ORDER.includes(roleOf(b)) ? ROLE_ORDER.indexOf(roleOf(b)) : 3) ||
      a.name.localeCompare(b.name),
  );
}
export function companionsMarkup(people, event) {
  const lines = orderedPeople(people).map(
    (p) => `<li><strong>${h(p.name)}</strong><span>${h(roleOf(p))}</span></li>`,
  );
  if (event?.driver_mode === "other")
    lines.push(
      `<li><strong>${h(event.other_driver_name || "For arrangement")}</strong><span>Driver${event.other_driver_name ? " · Other driver" : " · Pending"}</span></li>`,
    );
  return lines.length
    ? `<ul class="companion-lines">${lines.join("")}</ul>`
    : "Not assigned yet";
}
export function driverLabel(e, personnel) {
  if (e?.driver_mode === "other")
    return e.other_driver_name || "Other driver · For arrangement";
  return (
    personnel.find((p) => p.id === e?.driver_personnel_id)?.name ||
    "No driver selected · For arrangement"
  );
}
export function needsDriver(e, data) {
  if (e?.driver_mode === "other") return !e.other_driver_name?.trim();
  if (!e?.driver_personnel_id) return true;
  if (!data) return false;
  const person = data.personnel.find((p) => p.id === e.driver_personnel_id);
  return (
    !person?.active ||
    roleOf(person) !== "Driver" ||
    !data.assignments.some(
      (a) => a.personnel_id === person.id && a.event_id === e.id,
    )
  );
}
export function shiftCompanions(data, personId, date, code) {
  const group = dutyGroup(code);
  return orderedPeople(
    data.personnel.filter(
      (p) =>
        p.id !== personId &&
        data.assignments.some(
          (a) =>
            a.personnel_id === p.id &&
            a.work_date === date &&
            dutyGroup(a.code) === group,
        ),
    ),
  ).map((p) => ({
    ...p,
    code: data.assignments.find(
      (a) => a.personnel_id === p.id && a.work_date === date,
    )?.code,
  }));
}
export function assignmentTooltip(a, e, person, data) {
  if (!a) return "Unassigned";
  if (a.code === "CANCELLED")
    return `⚠ CANCELLED — Reassignment required\n${e?.title || "Event"}\n${e?.location || ""}\nAsk the administrator to assign a new duty.`;
  const lines = [CODES[a.code] || a.code, a.description];
  if (e)
    lines.push(
      e.title,
      `Location: ${e.location}`,
      `Call time: ${e.call_time?.slice(0, 5)} PHT`,
      e.notes,
      `Driver: ${driverLabel(e, data.personnel)}`,
      e.rpo_number ? `RPO: ${e.rpo_number}` : "",
      e.vehicle_name ? `Vehicle: ${e.vehicle_name}` : "",
    );
  if (["AM", "PM"].includes(dutyGroup(a.code))) {
    const companions = shiftCompanions(data, person.id, a.work_date, a.code);
    lines.push(
      "Companions:",
      ...companions.map((p) => `${p.name} · ${roleOf(p)} · ${p.code}`),
    );
    if (!companions.length)
      lines.push("No other personnel assigned to this shift.");
  }
  return lines.filter(Boolean).join("\n");
}
export function setupDutyPicker(form, selected = "", changed = () => {}) {
  const main = form.elements.code;
  const label = document.createElement("label");
  label.className = "form-full";
  label.innerHTML = 'Duty type<select name="sub_code"></select>';
  main.closest("label").after(label);
  const sub = form.elements.sub_code;
  const update = () => {
    const choices = DUTIES[main.value] || [];
    label.hidden = !choices.length;
    sub.required = Boolean(choices.length);
    sub.disabled = !choices.length;
    sub.innerHTML = choices
      .map((k) => `<option value="${k}">${h(CODES[k])} (${k})</option>`)
      .join("");
    if (selected === main.value && choices.length)
      sub.insertAdjacentHTML(
        "beforeend",
        `<option value="${selected}">${h(CODES[selected])} (existing)</option>`,
      );
    if (choices.includes(selected) || selected === main.value)
      sub.value = selected;
    changed();
  };
  main.addEventListener("change", () => {
    selected = "";
    update();
  });
  sub.addEventListener("change", changed);
  update();
  return () => (DUTIES[main.value] ? sub.value : main.value);
}
