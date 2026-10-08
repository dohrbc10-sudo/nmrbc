import { TITLES, eventDuty, roleOf } from "./logistics.js";
import { CODES, today, monthEnd, datesBetween, parseDate } from "./core.js";
const KEY = "nmrbc-demo-v1";
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
function seed() {
  const month = today().slice(0, 7);
  const people = [
    "A. Santos",
    "R. Perez",
    "M. Reyes",
    "L. Garcia",
    "J. Cruz",
    "P. Flores",
    "C. Ramos",
    "D. Rivera",
    "S. Mendoza",
    "T. Lim",
  ].map((name, i) => ({
    id: uid(),
    name,
    role_label:
      i < 6
        ? "MT"
        : i === 6
          ? "HPO"
          : i === 7
            ? "MO"
            : i === 8
              ? "Regular"
              : "Driver",
    sort_order: i,
    active: true,
    version: 1,
  }));
  const events = [
    {
      title: "Community blood drive",
      event_date: month + "-08",
      location: "Sample barangay covered court",
      call_time: "07:00",
      expected_donors: 100,
      crew: [0, 3, 7],
    },
    {
      title: "University donation day",
      event_date: month + "-14",
      location: "Sample university gymnasium",
      call_time: "06:30",
      expected_donors: 150,
      crew: [1, 4, 8],
    },
    {
      title: "Municipal blood drive",
      event_date: month + "-23",
      location: "Sample municipal hall",
      call_time: "07:30",
      expected_donors: 80,
      crew: [2, 5, 9],
    },
  ].map((e) => ({
    ...e,
    id: uid(),
    status: "confirmed",
    end_time: "16:00",
    contact_person: "Event coordinator",
    transport: "Service vehicle · meet at the center",
    notes:
      "Sample event only. Bring the collection kit and staff identification.",
    version: 1,
  }));
  const assignments = [];
  for (const d of datesBetween(month + "-01", monthEnd(month + "-01"))) {
    people.forEach((p, i) => {
      const event = events.find(
        (e) => e.event_date === d && e.crew.includes(i),
      );
      const weekend = [0, 6].includes(parseDate(d).getUTCDay());
      const code = event
        ? "MBD"
        : weekend
          ? "OFF"
          : ["AM/T", "AM/C", "PM", "OFFICE"][
              (i + parseDate(d).getUTCDate()) % 4
            ];
      assignments.push({
        id: uid(),
        personnel_id: p.id,
        work_date: d,
        code,
        event_id: event?.id ?? null,
        description: "",
        version: 1,
      });
    });
  }
  events.forEach((e) => delete e.crew);
  return {
    personnel: people,
    events,
    assignments,
    changes: [],
    catalog: TITLES.map((name) => ({
      id: uid(),
      kind: "title",
      name,
      details: "",
    })),
  };
}
export class DemoStore {
  constructor() {
    this.reload();
  }
  reload() {
    try {
      this.data = JSON.parse(localStorage.getItem(KEY)) || seed();
    } catch {
      this.data = seed();
    }
    this.data.catalog ||= TITLES.map((name) => ({
      id: uid(),
      kind: "title",
      name,
      details: "",
    }));
    localStorage.setItem(KEY, JSON.stringify(this.data));
  }
  async load() {
    this.reload();
    const visible = structuredClone(this.data);
    visible.changes = visible.changes.filter((c) => c.action !== "insert");
    return visible;
  }
  async older(id) {
    return this.data.changes
      .filter((c) => c.action !== "insert" && BigInt(c.id) < BigInt(id))
      .slice(0, 50);
  }
  async write(name, args) {
    this.reload();
    this.managingEvent = null;
    const before = structuredClone(this.data);
    try {
      if (!args.p_reason || args.p_reason.trim().length < 3)
        throw Error("Enter a change note of at least 3 characters.");
      let result;
      if (name === "scheduler_save_personnel") result = this.personnel(args);
      else if (name === "scheduler_apply_assignments")
        result = {
          changed: args.p_entries.reduce(
            (n, e) => n + this.assignment(e, args.p_reason),
            0,
          ),
        };
      else result = this.event(args);
      localStorage.setItem(KEY, JSON.stringify(this.data));
      return result;
    } catch (e) {
      this.data = before;
      throw e;
    }
  }
  log(resource, before, after, reason) {
    if (!before) return;
    if (
      before &&
      after &&
      JSON.stringify({ ...before, version: 0 }) ===
        JSON.stringify({ ...after, version: 0 })
    )
      return;
    const d = after || before;
    const person = this.data.personnel.find((p) => p.id === d.personnel_id);
    const summary =
      resource === "assignments"
        ? `${person?.name || "Personnel"} · ${d.work_date} · ${before?.code || "Unassigned"} → ${after?.code || "Unassigned"}`
        : `${d.name || d.title} · ${resource} ${before ? "updated" : "added"}`;
    this.data.changes.unshift({
      id: String(BigInt(this.data.changes[0]?.id || 0) + 1n),
      resource,
      action: !before ? "insert" : !after ? "delete" : "update",
      record_id: d.id,
      work_date: d.work_date || d.event_date,
      summary,
      actor_label: "Demo administrator",
      reason,
      before_data: before,
      after_data: after,
      occurred_at: now(),
    });
  }
  check(existing, expected) {
    if ((existing?.version || 0) !== expected)
      throw Error("This record changed. Refresh and reopen the editor.");
  }
  personnel(a) {
    const old = this.data.personnel.find((p) => p.id === a.p_id);
    this.check(old, a.p_expected_version);
    const row = {
      id: old?.id || uid(),
      name: a.p_name.trim(),
      role_label: a.p_role_label,
      sort_order: a.p_sort_order,
      active: a.p_active,
      version: (old?.version || 0) + 1,
    };
    if (!row.name) throw Error("Name is required.");
    if (old) this.data.personnel[this.data.personnel.indexOf(old)] = row;
    else this.data.personnel.push(row);
    this.log("personnel", old, row, a.p_reason);
    return row;
  }
  assignment(a, reason) {
    const old = this.data.assignments.find(
      (x) => x.personnel_id === a.personnel_id && x.work_date === a.work_date,
    );
    this.check(old, a.expected_version);
    if (a.code === "CANCELLED")
      throw Error("Cancellation markers are created by cancelling an event.");
    if (!a.code) {
      if (!old) return 0;
      if (old.code === "CANCELLED")
        throw Error(
          "Choose a new duty instead of clearing the cancellation warning.",
        );
      this.data.assignments.splice(this.data.assignments.indexOf(old), 1);
      this.log("assignments", old, null, reason);
      this.touch(old.event_id);
      return 1;
    }
    if (!this.data.personnel.find((p) => p.id === a.personnel_id && p.active))
      throw Error("Select active personnel.");
    if (!CODES[a.code]) throw Error("Choose a valid duty.");
    if (
      a.event_id &&
      !this.data.events.some(
        (e) =>
          e.id === a.event_id &&
          e.event_date === a.work_date &&
          e.status !== "cancelled" &&
          eventDuty(e) === a.code,
      )
    )
      throw Error("Choose an active activity matching this duty and date.");
    if (a.code === "MBD" && !a.event_id)
      throw Error("MBD requires an event on the same date.");
    if (
      old &&
      old.code === a.code &&
      old.description === (a.description || "") &&
      old.event_id === (a.event_id || null)
    )
      return 0;
    const row = {
      id: old?.id || uid(),
      personnel_id: a.personnel_id,
      work_date: a.work_date,
      code: a.code,
      description: a.description || "",
      event_id: a.event_id || null,
      version: this.nextAssignmentVersion(),
    };
    if (old) this.data.assignments[this.data.assignments.indexOf(old)] = row;
    else this.data.assignments.push(row);
    this.log("assignments", old, row, reason);
    new Set([old?.event_id, row.event_id]).forEach((id) => this.touch(id));
    return 1;
  }
  nextAssignmentVersion() {
    this.data.assignmentClock =
      Math.max(
        this.data.assignmentClock || 0,
        ...this.data.assignments.map((a) => a.version),
      ) + 1;
    return this.data.assignmentClock;
  }
  touch(id) {
    const e = this.data.events.find((e) => e.id === id);
    if (e) {
      e.version++;
      if (
        e.driver_personnel_id &&
        this.managingEvent !== e.id &&
        !this.data.assignments.some(
          (a) =>
            a.event_id === e.id &&
            a.personnel_id === e.driver_personnel_id &&
            a.work_date === e.event_date,
        )
      ) {
        const old = structuredClone(e);
        e.driver_personnel_id = null;
        this.log("events", old, e, "Driver assignment changed automatically.");
      }
    }
  }
  event(a) {
    const old = this.data.events.find((e) => e.id === a.p_id);
    this.check(old, a.p_expected_version);
    const values = {
      ...a.p_event,
      assignment_code: eventDuty({ title: a.p_event.title }),
    };
    const cancelled = values.status === "cancelled";
    if (cancelled && old && old.event_date !== values.event_date)
      throw Error(
        "Cancel on the original date. Reactivate before moving the event.",
      );
    if (
      values.driver_personnel_id &&
      !this.data.personnel.some(
        (p) =>
          p.id === values.driver_personnel_id &&
          roleOf(p) === "Driver" &&
          (p.active || (cancelled && p.id === old?.driver_personnel_id)),
      )
    )
      throw Error("Select active personnel with the Driver designation.");
    const ids = new Set(
      cancelled && old
        ? this.data.assignments
            .filter((x) => x.event_id === old.id)
            .map((x) => x.personnel_id)
        : [
            ...a.p_crew,
            ...(values.driver_personnel_id ? [values.driver_personnel_id] : []),
          ],
    );
    for (const id of ids) {
      if (
        !this.data.personnel.some(
          (p) =>
            p.id === id &&
            (p.active ||
              (cancelled &&
                this.data.assignments.some(
                  (x) => x.personnel_id === id && x.event_id === old?.id,
                ))),
        )
      )
        throw Error("Choose active personnel.");
      const conflict = this.data.assignments.find(
        (x) =>
          x.personnel_id === id &&
          x.work_date === values.event_date &&
          x.code !== "CANCELLED" &&
          x.event_id !== old?.id,
      );
      if (conflict)
        throw Error(
          `${this.data.personnel.find((p) => p.id === id).name} already has an assignment on this date. Clear that cell first.`,
        );
    }
    this.managingEvent = old?.id;
    if (old && !cancelled)
      for (const x of [...this.data.assignments].filter(
        (x) =>
          x.event_id === old.id &&
          (x.work_date !== values.event_date || !ids.has(x.personnel_id)),
      )) {
        this.data.assignments.splice(this.data.assignments.indexOf(x), 1);
        this.log("assignments", x, null, a.p_reason);
        this.touch(old.id);
      }
    const row = {
      ...values,
      id: old?.id || uid(),
      version: (old?.version || 0) + 1,
    };
    if (old) this.data.events[this.data.events.indexOf(old)] = row;
    else this.data.events.push(row);
    this.log("events", old, row, a.p_reason);
    this.managingEvent = row.id;
    for (const id of ids) {
      const cell = this.data.assignments.find(
        (x) => x.personnel_id === id && x.work_date === row.event_date,
      );
      if (cancelled) {
        if (cell?.code === "CANCELLED" && cell.event_id === row.id) continue;
        const marker = {
          id: cell?.id || uid(),
          personnel_id: id,
          work_date: row.event_date,
          code: "CANCELLED",
          event_id: row.id,
          description: "Event cancelled. Needs reassignment.",
          version: this.nextAssignmentVersion(),
        };
        if (cell)
          this.data.assignments[this.data.assignments.indexOf(cell)] = marker;
        else this.data.assignments.push(marker);
        this.log("assignments", cell, marker, a.p_reason);
        this.touch(row.id);
      } else
        this.assignment(
          {
            personnel_id: id,
            work_date: row.event_date,
            code: row.assignment_code,
            event_id: row.id,
            description: "",
            expected_version: cell?.version || 0,
          },
          a.p_reason,
        );
    }
    const remember = (kind, name, details = "") => {
      if (!name?.trim()) return;
      const existing = this.data.catalog.find(
        (c) =>
          c.kind === kind && c.name.toLowerCase() === name.trim().toLowerCase(),
      );
      if (existing) {
        if (kind === "vehicle") existing.details = details;
      } else
        this.data.catalog.push({ id: uid(), kind, name: name.trim(), details });
    };
    this.managingEvent = null;
    remember("title", row.title);
    remember("vehicle", row.vehicle_name, row.vehicle_details || "");
    return structuredClone(row);
  }
}
export class LiveStore {
  constructor(client) {
    this.client = client;
  }
  async all(table, configure = (q) => q) {
    let out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await configure(
        this.client.from(table).select("*"),
      ).range(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }
  async load(start, end) {
    const { data, error } = await this.client.rpc("scheduler_snapshot", {
      p_start: start,
      p_end: end,
    });
    if (error) throw error;
    if (!data) throw Error("Invalid schedule date range.");
    return data;
  }
  async older(id) {
    const { data, error } = await this.client
      .from("scheduler_changes")
      .select("*")
      .neq("action", "insert")
      .lt("id", id)
      .order("id", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data;
  }
  async write(name, args) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw error;
    return data;
  }
}
