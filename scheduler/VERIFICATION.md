# Verification

Checked on October 7, 2026 using Node.js 24, embedded PostgreSQL (PGlite 0.5.8), Playwright 1.62.1, Chromium 153, and the bundled Supabase JavaScript client 2.117.2.

- **18 calendar/database checks passed:** half-month lengths/leap years, weeks spanning month/year boundaries, HTML and CSV escaping, Philippine-time calendar export, public read-only access, blocked unauthenticated/non-admin edits and self-promotion, audited admin writes, stale-version rejection, no-op writes, atomic batch rollback, MBD crew conflicts, event/date association, crew edit concurrency, moving events/crew, cancellation, archival, stale editors after clearing/recreating a cell, and consistent public snapshots.
- **Browser workflows passed:** public roster, half-month navigation, MBD details without login, personal filtering, demo admin editing, edit notices, adding personnel/events, linked crew cells, bulk assignment preserving existing duties, clearing MBD cells, CSV download, print generation, logout, and local demo persistence. Desktop 1440px and mobile 390px widths were inspected; no JavaScript errors or page-wide mobile overflow were observed. The sample half-month roster printed on one landscape A4 page.
- **SDK-to-database integration passed:** the real browser Supabase SDK connected through a simulated Auth/PostgREST API to the actual SQL functions. Password login, ordinary-account rejection, admin role verification, assignment writes, event/crew writes, logout, persistence and public refresh were checked.

These checks use local fixtures. The project has not been deployed to your GitHub, Vercel, or Supabase accounts. After following SETUP.md, verify an admin edit appears when refreshing the deployed site in a separate private/incognito window. Password-reset delivery also depends on your Supabase SMTP and redirect URL settings.

Run `npm test` for the SQL/calendar checks. See SETUP.md for optional browser checks. The production website requires no npm install or build.
