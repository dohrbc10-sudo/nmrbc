# NMRBC personnel scheduler

Public personnel roster with protected admin editing, Mobile Blood Donation events, linked crew assignments, public edit notices/history, half-month/week/month views, staffing counts, print, CSV, and calendar export.

**Start here: [SETUP.md](SETUP.md).** It covers Supabase database setup, admin creation, GitHub upload, Vercel deployment, and usage.

- Website: `public/` — complete HTML/CSS/JS, bundled Supabase SDK.
- Database: `supabase/schema.sql` — tables, public-read RLS/grants, checked mutation functions, consistent snapshots, audit triggers.
- First admin: `supabase/add-admin.sql` — run after creating an Auth user.
- Configuration: `public/config.js` — project URL and **publishable** key only.
- Deployment: `vercel.json` — static output `public`, no install/build required.
- Verification: `tests/` — calendar/export and PostgreSQL permission/data-integrity checks.

Blank configuration runs the clearly labeled local demo. Configured mode uses only your Supabase records. Public users need no accounts. Each person has one assignment per date; all displayed details/history are public. Editing needs both an Auth login and membership in the private approved-admin table.

```sh
npm run dev
# Open http://localhost:3000
```

The browser Supabase SDK is version 2.117.2, included under its MIT license in `public/vendor/SUPABASE-LICENSE.txt`. Other project source is provided for you to use and modify.
