-- 1. Create the account first in Supabase: Authentication > Users > Add user.
-- 2. Replace BOTH example values below; run this in the SQL Editor.
-- This cannot be run from the public page.
DO $$
DECLARE admin_id uuid;
BEGIN
 SELECT id INTO admin_id FROM auth.users WHERE lower(email)=lower('YOUR_ADMIN_EMAIL@example.com');
 IF admin_id IS NULL THEN RAISE EXCEPTION 'Create the Auth user first, then enter its exact email here.'; END IF;
 INSERT INTO scheduler_private.admins(user_id,display_name)
 VALUES(admin_id,'Schedule administrator')
 ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name;
END $$;
