import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("Supabase schema permissions, audit history, atomic edits and MBD consistency", async (t) => {
  const db = new PGlite();
  const admin = "11111111-1111-4111-8111-111111111111",
    ordinary = "22222222-2222-4222-8222-222222222222";
  await db.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key,email text); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
  );
  const sql = fs.readFileSync(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(
    `INSERT INTO auth.users VALUES('${admin}','owner@example.test'),('${ordinary}','visitor@example.test');INSERT INTO scheduler_private.admins(user_id,display_name) VALUES('${admin}','Roster administrator');`,
  );
  const query = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rpc = async (name, args) => {
    const marks = args.map((_, i) => "$" + (i + 1)).join(",");
    return (await query(`select public.${name}(${marks}) as result`, args))[0]
      .result;
  };
  const role = async (name, uid = "") =>
    db.exec(
      `RESET ROLE; SET request.jwt.claim.sub='${uid}'; SET ROLE ${name};`,
    );
  const person = (id, version, name, active = true) =>
    rpc("scheduler_save_personnel", [
      id,
      version,
      name,
      "Technologist",
      0,
      active,
      "Update staffing coverage",
    ]);
  const apply = (entries) =>
    rpc("scheduler_apply_assignments", [
      JSON.stringify(entries),
      "Update the duty roster",
    ]);
  const entry = (p, date, code, version = 0, event = null) => ({
    personnel_id: p,
    work_date: date,
    code,
    description: "",
    event_id: event,
    expected_version: version,
  });
  const eventData = (date, status = "confirmed") => ({
    title: "Community drive",
    event_date: date,
    location: "Town hall",
    call_time: "07:00",
    end_time: "16:00",
    expected_donors: 100,
    contact_person: "Coordinator",
    transport: "Service vehicle",
    notes: "Bring supplies",
    status,
  });
  const saveEvent = (id, version, date, crew, status) =>
    rpc("scheduler_save_event", [
      id,
      version,
      JSON.stringify(eventData(date, status)),
      crew,
      "Confirm the mobile team",
    ]);
  const count = async (table) =>
    (await query(`select count(*)::int as n from public.${table}`))[0].n;
  let p1, p2, p3, event;
  await t.test(
    "Anonymous visitors read a consistent snapshot and cannot write or read admin records",
    async () => {
      await role("anon");
      assert.deepEqual(
        (await rpc("scheduler_snapshot", ["2026-10-01", "2026-10-31"]))
          .personnel,
        [],
      );
      assert.equal(await rpc("scheduler_is_admin", []), false);
      for (const name of [
        "scheduler_personnel",
        "scheduler_events",
        "scheduler_assignments",
        "scheduler_changes",
      ]) {
        await assert.rejects(
          db.exec(`delete from public.${name}`),
          /permission denied/,
        );
      }
      await assert.rejects(
        db.exec("select * from scheduler_private.admins"),
        /permission denied/,
      );
      await assert.rejects(person(null, 0, "Intruder"), /permission denied/);
    },
  );
  await t.test(
    "Authenticated non-admins cannot promote themselves or call write RPCs",
    async () => {
      await role("authenticated", ordinary);
      assert.equal(await rpc("scheduler_is_admin", []), false);
      await assert.rejects(
        person(null, 0, "Intruder"),
        /Administrator access required/,
      );
      await assert.rejects(
        db.exec(
          `insert into scheduler_private.admins(user_id,display_name) values('${ordinary}','Bad')`,
        ),
        /permission denied/,
      );
    },
  );
  await t.test(
    "Admin inserts are audited, with public actor labels and no email or UID",
    async () => {
      await role("authenticated", admin);
      p1 = await person(null, 0, "A. Santos");
      p2 = await person(null, 0, "R. Perez");
      p3 = await person(null, 0, "M. Reyes");
      const c = (
        await query(
          "select * from public.scheduler_changes order by id limit 1",
        )
      )[0];
      assert.equal(c.actor_label, "Roster administrator");
      assert.equal(c.reason, "Update staffing coverage");
      assert.equal(c.after_data.name, "A. Santos");
      assert.ok(!JSON.stringify(c).includes("owner@example"));
      assert.ok(!JSON.stringify(c).includes(admin));
      await assert.rejects(
        db.exec("update public.scheduler_personnel set name='Bypass'"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "Optimistic concurrency rejects stale edits; unchanged assignments add no audit rows",
    async () => {
      await apply([entry(p1.id, "2026-10-08", "AM/T")]);
      const old = (await query("select * from scheduler_assignments"))[0];
      await assert.rejects(
        apply([entry(p1.id, "2026-10-08", "PM", 0)]),
        /assignment changed/,
      );
      const n = await count("scheduler_changes");
      assert.deepEqual(
        await apply([entry(p1.id, "2026-10-08", "AM/T", old.version)]),
        { changed: 0 },
      );
      assert.equal(await count("scheduler_changes"), n);
    },
  );
  await t.test(
    "A stale entry rolls back the entire bulk operation",
    async () => {
      await assert.rejects(
        apply([
          entry(p2.id, "2026-10-08", "PM"),
          entry(p1.id, "2026-10-08", "AM/C", 0),
        ]),
        /assignment changed/,
      );
      assert.equal(
        (
          await query(
            "select * from scheduler_assignments where personnel_id=$1",
            [p2.id],
          )
        ).length,
        0,
      );
    },
  );
  await t.test(
    "Crew conflicts reject an entire event and preserve the original AM assignment",
    async () => {
      await assert.rejects(
        saveEvent(null, 0, "2026-10-08", [p1.id, p2.id]),
        /already has an assignment/,
      );
      assert.equal(await count("scheduler_events"), 0);
      assert.equal(
        (await query("select code from scheduler_assignments"))[0].code,
        "AM/T",
      );
    },
  );
  await t.test(
    "Event creation assigns crew; date and MBD association are checked server-side",
    async () => {
      event = await saveEvent(null, 0, "2026-10-09", [p1.id, p2.id]);
      const crew = await query(
        "select code,work_date::text as work_date from scheduler_assignments where event_id=$1",
        [event.id],
      );
      assert.equal(crew.length, 2);
      assert.ok(
        crew.every((a) => a.code === "MBD" && a.work_date === "2026-10-09"),
      );
      await assert.rejects(
        apply([entry(p3.id, "2026-10-10", "MBD", 0, event.id)]),
        /active MBD event/,
      );
      await assert.rejects(
        apply([entry(p3.id, "2026-10-09", "PM", 0, event.id)]),
        /Only MBD/,
      );
    },
  );
  await t.test(
    "Roster crew edits invalidate an already-open event editor",
    async () => {
      await apply([entry(p3.id, "2026-10-09", "MBD", 0, event.id)]);
      await assert.rejects(
        saveEvent(event.id, event.version, "2026-10-09", [p1.id, p2.id]),
        /event or crew changed/,
      );
      event = (
        await query("select * from scheduler_events where id=$1", [event.id])
      )[0];
    },
  );
  await t.test(
    "Moving an event moves all selected MBD cells in one transaction",
    async () => {
      event = await saveEvent(event.id, event.version, "2026-10-12", [
        p1.id,
        p2.id,
        p3.id,
      ]);
      const crew = await query(
        "select code,work_date::text as work_date from scheduler_assignments where event_id=$1",
        [event.id],
      );
      assert.equal(crew.length, 3);
      assert.ok(crew.every((a) => a.work_date === "2026-10-12"));
      assert.equal(
        (
          await query(
            "select * from scheduler_assignments where work_date='2026-10-09'",
          )
        ).length,
        0,
      );
    },
  );
  await t.test(
    "Cancellation clears its MBD cells and preserves unrelated shifts and immutable history",
    async () => {
      const before = await count("scheduler_changes");
      event = await saveEvent(
        event.id,
        event.version,
        "2026-10-12",
        [],
        "cancelled",
      );
      assert.equal(
        (
          await query(
            "select code,work_date::text as work_date from scheduler_assignments where event_id=$1",
            [event.id],
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await query(
            "select code from scheduler_assignments where work_date='2026-10-08'",
          )
        )[0].code,
        "AM/T",
      );
      assert.ok((await count("scheduler_changes")) > before);
      await assert.rejects(
        apply([entry(p3.id, "2026-10-12", "MBD", 0, event.id)]),
        /active MBD event/,
      );
    },
  );
  await t.test(
    "Archived personnel retain history and cannot receive new duties",
    async () => {
      p1 = await person(p1.id, p1.version, p1.name, false);
      await assert.rejects(
        apply([entry(p1.id, "2026-10-13", "PM")]),
        /active personnel/,
      );
      assert.equal(
        (
          await query(
            "select * from scheduler_assignments where personnel_id=$1",
            [p1.id],
          )
        ).length,
        1,
      );
      await assert.rejects(person(p1.id, 1, "Overwrite"), /Personnel changed/);
    },
  );
  await t.test(
    "Clearing and recreating a cell cannot fool a stale editor with a reused version",
    async () => {
      await apply([entry(p2.id, "2026-10-15", "PM")]);
      const original = (
        await query(
          "select * from scheduler_assignments where personnel_id=$1 and work_date='2026-10-15'",
          [p2.id],
        )
      )[0];
      await apply([entry(p2.id, "2026-10-15", "", original.version)]);
      await apply([entry(p2.id, "2026-10-15", "AM/C")]);
      await assert.rejects(
        apply([entry(p2.id, "2026-10-15", "OFF", original.version)]),
        /assignment changed/,
      );
      const current = (
        await query(
          "select * from scheduler_assignments where personnel_id=$1 and work_date='2026-10-15'",
          [p2.id],
        )
      )[0];
      await apply([entry(p2.id, "2026-10-15", "", current.version)]);
    },
  );
  await t.test(
    "Final public snapshot includes events, crew, audit changes and no private admin data",
    async () => {
      await role("anon");
      const snapshot = await rpc("scheduler_snapshot", [
        "2026-10-01",
        "2026-10-31",
      ]);
      assert.equal(snapshot.personnel.length, 3);
      assert.equal(snapshot.events[0].status, "cancelled");
      assert.equal(snapshot.assignments.length, 1);
      assert.ok(snapshot.changes.length > 5);
      assert.equal(typeof snapshot.changes[0].id, "string");
      assert.ok(!JSON.stringify(snapshot).includes(admin));
      assert.equal(
        await rpc("scheduler_snapshot", ["2026-10-01", "2027-10-01"]),
        null,
      );
    },
  );
  await db.close();
});
