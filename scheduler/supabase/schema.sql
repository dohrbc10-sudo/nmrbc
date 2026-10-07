-- NMRBC Scheduler. Run in your Supabase SQL Editor as the project owner.
-- Separate scheduler_ tables; this does not alter your blood-bank tables.
BEGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE SCHEMA IF NOT EXISTS scheduler_private;
REVOKE ALL ON SCHEMA scheduler_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS scheduler_private.admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE scheduler_private.admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scheduler_private.admins FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.scheduler_personnel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
  role_label text NOT NULL DEFAULT '' CHECK(length(role_label)<=120),
  sort_order integer NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 100000),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.scheduler_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  event_date date NOT NULL,
  location text NOT NULL CHECK(length(btrim(location)) BETWEEN 1 AND 300),
  call_time time NOT NULL,
  end_time time,
  expected_donors integer NOT NULL DEFAULT 0 CHECK(expected_donors BETWEEN 0 AND 100000),
  contact_person text NOT NULL DEFAULT '' CHECK(length(contact_person)<=160),
  transport text NOT NULL DEFAULT '' CHECK(length(transport)<=300),
  notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
  status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','confirmed','cancelled')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.scheduler_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personnel_id uuid NOT NULL REFERENCES public.scheduler_personnel(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  code text NOT NULL CHECK(code IN ('AM/T','AM/C','AM','PM','MBD','OFF','LEAVE','OFFICE','TRAINING')),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
  event_id uuid REFERENCES public.scheduler_events(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(personnel_id,work_date),
  CHECK((code='MBD' AND event_id IS NOT NULL) OR (code<>'MBD' AND event_id IS NULL))
);
CREATE TABLE IF NOT EXISTS public.scheduler_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource text NOT NULL,
  action text NOT NULL,
  record_id uuid NOT NULL,
  work_date date,
  summary text NOT NULL,
  actor_label text NOT NULL,
  reason text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduler_assignment_date_idx ON public.scheduler_assignments(work_date);
CREATE INDEX IF NOT EXISTS scheduler_assignment_event_idx ON public.scheduler_assignments(event_id);
CREATE INDEX IF NOT EXISTS scheduler_event_date_idx ON public.scheduler_events(event_date);
CREATE INDEX IF NOT EXISTS scheduler_change_date_idx ON public.scheduler_changes(occurred_at DESC);

-- Public read only. Every write goes through a checked RPC below.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scheduler_personnel','scheduler_events','scheduler_assignments','scheduler_changes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated',t);
    EXECUTE format('DROP POLICY IF EXISTS scheduler_public_read ON public.%I',t);
    EXECUTE format('CREATE POLICY scheduler_public_read ON public.%I FOR SELECT TO anon, authenticated USING (true)',t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.scheduler_changes_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.scheduler_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM scheduler_private.admins WHERE user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.scheduler_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduler_is_admin() TO anon, authenticated;

CREATE OR REPLACE FUNCTION scheduler_private.begin_write(p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.scheduler_is_admin() THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'Enter a public change note of 3 to 500 characters.';
  END IF;
  -- Small roster: serialize app edits and event/crew changes in one transaction.
  PERFORM pg_advisory_xact_lock(741952, 1);
  PERFORM set_config('scheduler.change_reason',btrim(p_reason),true);
END $$;
REVOKE ALL ON FUNCTION scheduler_private.begin_write(text) FROM PUBLIC, anon, authenticated;

-- Never reuse a version after a cell is cleared and recreated.
-- A global sequence closes the stale-editor delete/recreate (ABA) case.
CREATE SEQUENCE IF NOT EXISTS scheduler_private.record_versions AS integer;
REVOKE ALL ON SEQUENCE scheduler_private.record_versions FROM PUBLIC, anon, authenticated;
DO $$ DECLARE current_max integer; sequence_value bigint; BEGIN
 SELECT greatest(coalesce((SELECT max(version) FROM public.scheduler_personnel),0),
   coalesce((SELECT max(version) FROM public.scheduler_events),0),
   coalesce((SELECT max(version) FROM public.scheduler_assignments),0)) INTO current_max;
 SELECT last_value INTO sequence_value FROM scheduler_private.record_versions;
 IF current_max>=sequence_value AND current_max>0 THEN PERFORM setval('scheduler_private.record_versions',current_max,true); END IF;
END $$;

CREATE OR REPLACE FUNCTION scheduler_private.bump_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.version:=nextval('scheduler_private.record_versions'); NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION scheduler_private.audit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b jsonb; a jsonb; d jsonb; who text; person_name text; summary_text text; date_value date; resource_name text;
BEGIN
  IF TG_OP<>'INSERT' THEN b:=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN a:=to_jsonb(NEW); END IF;
  -- Event version changes caused by crew edits are covered by assignment history.
  IF TG_OP='UPDATE' AND (b - ARRAY['version','updated_at'])=(a - ARRAY['version','updated_at']) THEN RETURN NEW; END IF;
  d:=coalesce(a,b);
  SELECT display_name INTO who FROM scheduler_private.admins WHERE user_id=auth.uid();
  who:=coalesce(who,'Project administrator');
  resource_name:=replace(TG_TABLE_NAME,'scheduler_','');
  IF TG_TABLE_NAME='scheduler_personnel' THEN
    summary_text:=d->>'name'||' · personnel '||lower(TG_OP);
  ELSIF TG_TABLE_NAME='scheduler_events' THEN
    date_value:=(d->>'event_date')::date;
    summary_text:=d->>'title'||' · MBD event '||lower(TG_OP);
  ELSE
    SELECT name INTO person_name FROM public.scheduler_personnel WHERE id=(d->>'personnel_id')::uuid;
    date_value:=(d->>'work_date')::date;
    summary_text:=coalesce(person_name,'Personnel')||' · '||to_char(date_value,'DD Mon YYYY')||' · '||
      coalesce(b->>'code','Unassigned')||' → '||coalesce(a->>'code','Unassigned');
  END IF;
  INSERT INTO public.scheduler_changes(resource,action,record_id,work_date,summary,actor_label,reason,before_data,after_data)
    VALUES(resource_name,lower(TG_OP),(d->>'id')::uuid,date_value,summary_text,who,
      coalesce(nullif(current_setting('scheduler.change_reason',true),''),'Updated in database'),b,a);
  RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION scheduler_private.bump_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION scheduler_private.audit_change() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['scheduler_personnel','scheduler_events','scheduler_assignments'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS scheduler_version ON public.%I',t);
  EXECUTE format('CREATE TRIGGER scheduler_version BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION scheduler_private.bump_version()',t);
  EXECUTE format('DROP TRIGGER IF EXISTS scheduler_audit ON public.%I',t);
  EXECUTE format('CREATE TRIGGER scheduler_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION scheduler_private.audit_change()',t);
 END LOOP;
END $$;

-- Changing an event's crew invalidates a stale event editor, too.
CREATE OR REPLACE FUNCTION scheduler_private.touch_linked_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_id:=OLD.event_id; END IF;
 IF TG_OP<>'DELETE' THEN new_id:=NEW.event_id; END IF;
 UPDATE public.scheduler_events SET updated_at=clock_timestamp() WHERE id=old_id OR id=new_id;
 RETURN coalesce(NEW,OLD);
END $$;
REVOKE ALL ON FUNCTION scheduler_private.touch_linked_event() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS scheduler_touch_event ON public.scheduler_assignments;
CREATE TRIGGER scheduler_touch_event AFTER INSERT OR UPDATE OR DELETE ON public.scheduler_assignments
 FOR EACH ROW EXECUTE FUNCTION scheduler_private.touch_linked_event();

CREATE OR REPLACE FUNCTION public.scheduler_save_personnel(p_id uuid,p_expected_version integer,p_name text,p_role_label text,p_sort_order integer,p_active boolean,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.scheduler_personnel; BEGIN
 PERFORM scheduler_private.begin_write(p_reason);
 IF p_id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invalid new personnel version.'; END IF;
  INSERT INTO public.scheduler_personnel(name,role_label,sort_order,active)
   VALUES(btrim(p_name),btrim(coalesce(p_role_label,'')),p_sort_order,p_active) RETURNING * INTO r;
 ELSE
  SELECT * INTO r FROM public.scheduler_personnel WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR r.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Personnel changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
  IF (r.name,r.role_label,r.sort_order,r.active) IS DISTINCT FROM (btrim(p_name),btrim(coalesce(p_role_label,'')),p_sort_order,p_active) THEN
   UPDATE public.scheduler_personnel SET name=btrim(p_name),role_label=btrim(coalesce(p_role_label,'')),sort_order=p_sort_order,active=p_active WHERE id=p_id RETURNING * INTO r;
  END IF;
 END IF;
 RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.scheduler_save_personnel(uuid,integer,text,text,integer,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_save_personnel(uuid,integer,text,text,integer,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION scheduler_private.apply_assignment(p_personnel uuid,p_date date,p_code text,p_description text,p_event uuid,p_expected_version integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.scheduler_assignments; e public.scheduler_events; active_person boolean;
BEGIN
 IF p_personnel IS NULL OR p_date IS NULL OR p_expected_version IS NULL THEN RAISE EXCEPTION 'Personnel, date and expected version are required.'; END IF;
 SELECT * INTO r FROM public.scheduler_assignments WHERE personnel_id=p_personnel AND work_date=p_date FOR UPDATE;
 IF coalesce(r.version,0)<>p_expected_version THEN RAISE EXCEPTION 'An assignment changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 IF nullif(p_code,'') IS NULL THEN
  IF r.id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.scheduler_assignments WHERE id=r.id; RETURN true;
 END IF;
 SELECT active INTO active_person FROM public.scheduler_personnel WHERE id=p_personnel;
 IF active_person IS DISTINCT FROM true THEN RAISE EXCEPTION 'Select an active personnel record.'; END IF;
 IF p_code='MBD' THEN
  SELECT * INTO e FROM public.scheduler_events WHERE id=p_event;
  IF e.id IS NULL OR e.event_date<>p_date OR e.status='cancelled' THEN RAISE EXCEPTION 'Choose an active MBD event on this assignment date.'; END IF;
 ELSIF p_event IS NOT NULL THEN RAISE EXCEPTION 'Only MBD assignments can have an event.';
 END IF;
 IF r.id IS NULL THEN
  INSERT INTO public.scheduler_assignments(personnel_id,work_date,code,description,event_id)
   VALUES(p_personnel,p_date,p_code,btrim(coalesce(p_description,'')),p_event);
 ELSIF (r.code,r.description,r.event_id) IS DISTINCT FROM (p_code,btrim(coalesce(p_description,'')),p_event) THEN
  UPDATE public.scheduler_assignments SET code=p_code,description=btrim(coalesce(p_description,'')),event_id=p_event WHERE id=r.id;
 ELSE RETURN false;
 END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION scheduler_private.apply_assignment(uuid,date,text,text,uuid,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.scheduler_apply_assignments(p_entries jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE entry jsonb; changed integer:=0;
BEGIN
 PERFORM scheduler_private.begin_write(p_reason);
 IF p_entries IS NULL OR jsonb_typeof(p_entries)<>'array' THEN RAISE EXCEPTION 'Submit an assignment array.'; END IF;
 IF jsonb_array_length(p_entries) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Submit between 1 and 5000 assignments.'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_entries) LOOP
  IF scheduler_private.apply_assignment((entry->>'personnel_id')::uuid,(entry->>'work_date')::date,
   entry->>'code',entry->>'description',nullif(entry->>'event_id','')::uuid,(entry->>'expected_version')::integer) THEN changed:=changed+1; END IF;
 END LOOP;
 RETURN jsonb_build_object('changed',changed);
END $$;
REVOKE ALL ON FUNCTION public.scheduler_apply_assignments(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_apply_assignments(jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.scheduler_save_event(p_id uuid,p_expected_version integer,p_event jsonb,p_crew uuid[],p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.scheduler_events; person uuid; new_date date; new_status text; conflict_name text; crew uuid[];
BEGIN
 PERFORM scheduler_private.begin_write(p_reason);
 new_date:=(p_event->>'event_date')::date;
 new_status:=coalesce(p_event->>'status','planned');
 crew:=coalesce(p_crew,ARRAY[]::uuid[]);
 IF cardinality(crew)>200 THEN RAISE EXCEPTION 'At most 200 companions may be assigned.'; END IF;
 IF new_status='cancelled' THEN crew:=ARRAY[]::uuid[]; END IF;
 IF p_id IS NULL THEN
  IF p_expected_version IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Invalid new event version.'; END IF;
 ELSE
  SELECT * INTO e FROM public.scheduler_events WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR e.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'This event or crew changed. Refresh and try again.' USING ERRCODE='40001'; END IF;
 END IF;
 IF new_date IS NULL THEN RAISE EXCEPTION 'Event date is required.'; END IF;
 FOREACH person IN ARRAY crew LOOP
  SELECT name INTO conflict_name FROM public.scheduler_personnel WHERE id=person AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Every companion must be an active personnel record.'; END IF;
  IF EXISTS(SELECT 1 FROM public.scheduler_assignments WHERE personnel_id=person AND work_date=new_date AND (p_id IS NULL OR event_id IS DISTINCT FROM p_id)) THEN
   RAISE EXCEPTION '% already has an assignment on %. Clear or change that cell first.',conflict_name,new_date;
  END IF;
 END LOOP;
 IF p_id IS NOT NULL THEN
  DELETE FROM public.scheduler_assignments WHERE event_id=p_id AND (work_date<>new_date OR NOT personnel_id=ANY(crew));
 END IF;
 IF p_id IS NULL THEN
  INSERT INTO public.scheduler_events(title,event_date,location,call_time,end_time,expected_donors,contact_person,transport,notes,status)
  VALUES(btrim(p_event->>'title'),new_date,btrim(p_event->>'location'),(p_event->>'call_time')::time,
   nullif(p_event->>'end_time','')::time,(p_event->>'expected_donors')::integer,btrim(coalesce(p_event->>'contact_person','')),
   btrim(coalesce(p_event->>'transport','')),btrim(coalesce(p_event->>'notes','')),new_status) RETURNING * INTO e;
 ELSE
  UPDATE public.scheduler_events SET title=btrim(p_event->>'title'),event_date=new_date,location=btrim(p_event->>'location'),
   call_time=(p_event->>'call_time')::time,end_time=nullif(p_event->>'end_time','')::time,expected_donors=(p_event->>'expected_donors')::integer,
   contact_person=btrim(coalesce(p_event->>'contact_person','')),transport=btrim(coalesce(p_event->>'transport','')),
   notes=btrim(coalesce(p_event->>'notes','')),status=new_status WHERE id=p_id RETURNING * INTO e;
 END IF;
 FOREACH person IN ARRAY crew LOOP
  IF NOT EXISTS(SELECT 1 FROM public.scheduler_assignments WHERE personnel_id=person AND work_date=new_date AND event_id=e.id) THEN
   INSERT INTO public.scheduler_assignments(personnel_id,work_date,code,event_id) VALUES(person,new_date,'MBD',e.id);
  END IF;
 END LOOP;
 SELECT * INTO e FROM public.scheduler_events WHERE id=e.id;
 RETURN to_jsonb(e);
END $$;
REVOKE ALL ON FUNCTION public.scheduler_save_event(uuid,integer,jsonb,uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scheduler_save_event(uuid,integer,jsonb,uuid[],text) TO authenticated;
-- One database snapshot keeps the event version and its crew consistent.
CREATE OR REPLACE FUNCTION public.scheduler_snapshot(p_start date,p_end date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT jsonb_build_object(
 'personnel',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY sort_order,name,id) FROM public.scheduler_personnel p),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY event_date,id) FROM public.scheduler_events e WHERE event_date BETWEEN p_start AND p_end),'[]'::jsonb),
 'assignments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.scheduler_assignments a WHERE work_date BETWEEN p_start AND p_end),'[]'::jsonb),
 'changes',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('id',c.id::text) ORDER BY id DESC) FROM (SELECT * FROM public.scheduler_changes ORDER BY id DESC LIMIT 50)c),'[]'::jsonb)
 ) WHERE p_start IS NOT NULL AND p_end>=p_start AND p_end-p_start<=62;
$$;
REVOKE ALL ON FUNCTION public.scheduler_snapshot(date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduler_snapshot(date,date) TO anon, authenticated;
COMMIT;
