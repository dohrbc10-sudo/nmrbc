# NMRBC scheduling app — setup guide

This is a complete static HTML, CSS, and JavaScript project. GitHub stores the files, Vercel serves the website, and Supabase stores schedules and handles admin login. Public visitors do not need accounts.

Start with the complete ZIP. Extract it and open the `nmrbc-scheduler` folder. Keep the folder structure intact: `public/index.html` needs the other files in `public/`.

## 1. Try the sample first

Leave both Supabase settings in `public/config.js` empty. You will see a clearly labeled demo with sample personnel, duties, and MBD events. Demo changes stay in your browser only.

To preview locally, install Node.js, open a terminal inside the project folder, and run:

```sh
npm run dev
```

Then open **http://localhost:3000**. This preview does not need `npm install`. Use **Admin login → Try demo editing** to test the forms. You can also upload the project to Vercel before configuring Supabase and try the demo there.

## 2. Create the Supabase database

1. Sign in at [Supabase](https://supabase.com/dashboard) and create a project. A separate scheduling project makes setup easier to manage.
2. Wait for the database to finish provisioning.
3. Open **SQL Editor → New query**.
4. Copy all of `supabase/schema.sql` into the editor and run it as the project owner.
5. Check the Table Editor. You should see:
   - `scheduler_personnel`
   - `scheduler_assignments`
   - `scheduler_events`
   - `scheduler_changes`
6. The private `scheduler_private.admins` table holds approved administrators. It is intentionally unavailable to the public website.

The SQL creates its own scheduler tables. It does not modify an existing blood-bank application. You may rerun this initial schema without deleting its data; it is not a general migration script for unrelated/customized schemas.

No Realtime publication is required. The app refreshes every 45 seconds while visible, when you return to the page, or when you press Refresh.

## 3. Create your first administrator

1. In Supabase, open **Authentication → Users** and use the dashboard's **Add user / Create user** action.
2. Enter the administrator's real email and a strong password (at least 12 characters recommended). Confirm the email through the dashboard or the confirmation email so password login is allowed.
3. Open `supabase/add-admin.sql`.
4. Replace `YOUR_ADMIN_EMAIL@example.com` with exactly the email you created. Change `Schedule administrator` to the public display name you want in edit history.
5. Run the edited SQL in the SQL Editor.
6. In Authentication settings, disable public **Allow new users to sign up** if it is enabled. This site has no signup form. Creating an Auth user alone never grants editing rights; the private admin list is also checked by the database.

Repeat the dashboard user creation and admin SQL for each additional administrator. Do not put passwords in GitHub or `config.js`.

To remove an administrator's editing permission without deleting their Auth account, run this in the SQL Editor with their email:

```sql
DELETE FROM scheduler_private.admins
WHERE user_id = (
  SELECT id FROM auth.users
  WHERE lower(email) = lower('ADMIN_TO_REMOVE@example.com')
);
```

They can still view the public schedule, but subsequent writes will be rejected by the database.

## 4. Connect the website to Supabase

1. In your Supabase project, find **Project Settings → API / API Keys** (or the project's Connect dialog).
2. Copy the **Project URL**, for example `https://your-project.supabase.co`.
3. Copy the **publishable key**, usually starting with `sb_publishable_`. The legacy `anon` key is also supported.
4. Edit `public/config.js`:

```js
window.SCHEDULER_CONFIG = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabasePublishableKey: "YOUR_PUBLISHABLE_KEY",
  organization: "Northern Mindanao Regional Blood Center",
  pollSeconds: 45,
});
```

The project URL and publishable key are public client settings. **Never use a secret key, a `service_role` key, or your database password here.** Public read permissions and checked database functions protect writes. The app also rejects recognizable secret/service-role keys.

These settings are read directly from `config.js`. Vercel environment variables do **not** automatically replace values in this plain HTML project.

After configuration, the app shows your live database. It starts empty; sample schedules are never copied to Supabase. Sign in as an approved admin, add personnel, then create duties/events.

## 5. Upload the complete project to GitHub

1. Create a GitHub repository, for example `nmrbc-scheduler`.
2. Use **Add file → Upload files** and upload the contents of the extracted project folder.
3. At the repository root, you should see `public/`, `supabase/`, `scripts/`, `tests/`, `vercel.json`, `package.json`, and this guide. Do not upload only `index.html`.
4. Commit the files. Your publishable key may be committed; admin passwords and secret keys must never be committed.

Alternatively, from inside the project folder:

```sh
git init
git add .
git commit -m "Add personnel scheduling app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/nmrbc-scheduler.git
git push -u origin main
```

Use your actual repository URL. A private repository is fine; connect it to Vercel with the required access.

## 6. Deploy on Vercel

1. Sign in to [Vercel](https://vercel.com/) with GitHub.
2. Choose **Add New → Project**, then import your scheduling repository.
3. Use these project settings:

| Setting          | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Framework preset | Other                                                |
| Root directory   | Repository root; the folder containing `vercel.json` |
| Build command    | Empty / disabled                                     |
| Install command  | Empty / disabled                                     |
| Output directory | `public`                                             |

4. Deploy. The included `vercel.json` already specifies these static-site settings.
5. Open the deployed URL. A **Live · public roster** badge confirms the website loaded a database snapshot. A **Demo · local data** badge means the Supabase settings are still empty.
6. Future commits to your production branch will deploy updated website files automatically.

`public/vendor/supabase.js` is already bundled. Vercel does not need to install npm dependencies or run a build. Only `public/` is served; database SQL and test files are not public website assets.

## 7. Set Auth URLs

After deployment, open Supabase **Authentication → URL Configuration**:

- **Site URL:** your production Vercel URL, such as `https://nmrbc-scheduler.vercel.app`.
- **Redirect URLs:** add `https://nmrbc-scheduler.vercel.app/` exactly.
- For local password reset testing, also allow `http://localhost:3000/`.

Use your real URL, including a custom domain if you have one. The password reset button uses the current website's origin; allow any preview URL you deliberately use for that feature. See Supabase's official redirect URL guidance for wildcard previews.

Admin login uses email/password. Password reset depends on your project's Auth email delivery settings; configure the project's SMTP provider for normal production email delivery.

## Using the scheduler

### Public view

- Use **1–15**, **16–end**, **Week**, or **Month**. February and leap years are handled automatically.
- Use the arrows, month picker, or Today button to change periods. Week runs Monday–Sunday.
- Choose your name under **My schedule**; it is remembered on that browser.
- Search by name/role or hide weekends. Counts, print, and CSV follow the people/dates currently shown.
- Click **MBD** to see the venue, date, companions, call time in Philippine time, expected donors, contact, transport, and notes. Download the event as a calendar file if useful.
- New edits show a notice. View the change history and mark changes as seen when you have reviewed them. This is a browser-based notice, not email, SMS, or a push notification.
- Print produces a landscape roster. Month view fits more dates into a page; half-month views have larger cells. CSV exports can be opened in Excel.

### Administrator

- **Personnel:** add names/roles, adjust display order, or archive personnel. Existing schedules/history are retained.
- **Roster:** click a cell to set AM/T, AM/C, custom AM, PM, OFF, LEAVE, OFFICE, TRAINING, or MBD. Add an optional duty description. A dash means unassigned, not a day off.
- **MBD events:** create an event and choose companions. Each chosen person's MBD cell is created automatically. Clicking an existing MBD cell provides both event editing and **Change this assignment**.
- A person may have **one assignment per date** in this version. If someone already has a duty, clear/change that cell before adding them to an MBD event. Two MBD events on the same date cannot both claim the same person.
- Changing an event's date moves its selected crew's MBD cells. Removing a companion clears their linked cell. Cancelling the event clears its crew's MBD cells while preserving the event and edit history.
- **Assign a range:** fill multiple people/dates at once. Existing assignments are skipped unless you explicitly check replacement. This can also replace MBD cells, which removes those people from that event's crew.
- Every write requires a **public change note**. The database records the old/new values and admin display name. Auth email addresses and admin account IDs are not copied into public history.
- Stale edits are rejected. Close the editor, refresh, reopen it, review the current values, and save again. A bulk operation either succeeds together or rolls back together.

All roster names, roles, duty descriptions, MBD details, and change notes are publicly readable, as requested. Enter information suitable for that public page. Admin login protects editing, not viewing.

### Helpful features included

Color-coded duty legend; sticky personnel/date headings; daily AM/PM/MBD staffing counts; workload totals; public edit notices; readable before/after history; date-range assignment; crew conflicts; archived personnel; printable rosters; CSV export with formula-injection protection; calendar export; mobile table scrolling; periodic refresh; password reset.

## Troubleshooting

| What you see                                            | What to do                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Demo badge after deployment                             | Fill both values in `public/config.js`, commit, and redeploy.                                                         |
| Setup required / invalid API key                        | Check the project URL and publishable key. Use the API key, not a dashboard access token.                             |
| Could not find `scheduler_snapshot` or another function | Run the complete `schema.sql` in the same project whose URL is in `config.js`.                                        |
| Login works but no editing rights                       | Run `add-admin.sql` for that exact Auth user's email.                                                                 |
| Email not confirmed                                     | Confirm the administrator's email in Supabase Authentication.                                                         |
| Person already has an assignment                        | Clear/change their existing roster cell on the event date, then save the event again.                                 |
| Record changed / stale edit                             | Close the dialog, Refresh, and reopen it. Do not overwrite another admin's work.                                      |
| Password reset email not arriving                       | Check Auth email/SMTP settings and URL Configuration.                                                                 |
| Live badge, empty roster                                | Add personnel and assignments as an admin; live mode contains no demo records.                                        |
| Connection unavailable                                  | Check connectivity and the Supabase project. The last displayed roster remains visible with its previous update time. |

The included Content Security Policy allows standard `*.supabase.co` endpoints. If using a Supabase custom domain, add its HTTPS/WSS origin to `connect-src` in `vercel.json` and redeploy.

## Optional developer checks

Node.js 22 or newer is recommended for the included development dependencies.

```sh
npm install
npm test
```

Tests execute the actual SQL schema in an embedded PostgreSQL engine with simulated Supabase roles/Auth UID. They check public read-only access, blocked non-admin writes, version conflicts, atomic batches, crew/date integrity, cancellation, archival, and audit history. They are not a substitute for verifying your deployed project's configuration.

Optional desktop/mobile browser and simulated API integration checks:

```sh
npx playwright install chromium
npm run test:browser
npm run test:live
```

The browser test writes previews into `test-results/`. The live integration test uses the real browser SDK with a simulated Auth/PostgREST endpoint and the actual SQL functions in embedded PostgreSQL; it does not need or contact your Supabase account.

To regenerate the bundled Supabase browser SDK after intentionally updating its pinned dependency:

```sh
npm run vendor
```

Commit the regenerated vendor file and license. No regeneration is needed to use the included version.

## Official references

- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase password sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Vercel Git deployments](https://vercel.com/docs/git)
- [Vercel project configuration](https://vercel.com/docs/project-configuration)
