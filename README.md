# Insurance Leads Site

A public lead-capture form for health insurance shoppers, plus a private, password-protected
dashboard for reviewing and calling leads.

## What's included

- `public/index.html` — the public-facing form (name, phone, email, ZIP, coverage type, current
  coverage status, household size, age range, best day/time to call, and a consent checkbox).
- `server.js` — plain Node.js HTTP server (no npm packages required): `POST /api/leads` saves
  submissions; `/dashboard` (password protected via HTTP Basic Auth) lists and filters leads,
  updates call status, and exports CSV.
- `store.js` — file-based storage; leads are saved to `data/leads.json`.
- `db.js` — **not used**, kept only as a reference SQLite schema if you outgrow the JSON file and
  want to switch to a real database later.

This has zero external dependencies on purpose — it runs with just Node.js installed, nothing to
`npm install`, and nothing that needs native compilation on your host.

## Running it locally

```bash
cd insurance-leads-site
cp .env.example .env   # then edit DASHBOARD_USER / DASHBOARD_PASSWORD
npm start               # or: node server.js
```

- Public form: http://localhost:3000
- Dashboard: http://localhost:3000/dashboard (prompts for the username/password you set in `.env`)

**Change the default dashboard password before putting this anywhere near the internet.** The
default in `.env.example` is a placeholder, not a real credential.

## Deploying

This is a plain Node.js app with no dependencies, so it runs on any Node host: Render, Railway,
Fly.io, a VPS, etc.

1. Push this folder to a GitHub repo (or upload directly to your host).
2. Set the `DASHBOARD_USER` and `DASHBOARD_PASSWORD` environment variables on the host — don't
   leave them at the defaults.
3. Point the host's start command at `npm start` (or `node server.js`).
4. Point your domain at the deployed app.

Note on storage: leads are saved to `data/leads.json` on disk, which is fine to start but will
reset if your host doesn't persist disk storage (common on some free tiers of serverless-style
hosts). Render and Railway's standard web services keep a persistent disk. If you outgrow the JSON
file or need multiple people editing leads at once, move to a real database (Postgres via Supabase,
or SQLite via `better-sqlite3` — see the reference schema in `db.js`) and swap out `store.js`.

## Using the dashboard

- Filter by status or search by name/phone/email/ZIP.
- Click a phone number to call it directly (on a phone/softphone-enabled browser).
- Update a lead's status (New / Called / Interested / Not Interested) — timestamps when marked "Called."
- Export the currently visible leads to CSV.

## Compliance — read this before using it to call people

This form includes basic TCPA-style consent language and a "not an offer of insurance" disclaimer,
but I'm not a lawyer and this is not legal advice. Before using this for real outreach:

- Telemarketing and text/call consent rules (TCPA in the US) apply to using collected phone numbers
  to call or text people, especially with autodialers. Requirements vary by how you contact people.
- Insurance sales generally requires you to be a licensed agent/broker in the state(s) you're
  selling into, and some states have their own telemarketing and insurance-specific lead rules.
- You'll want a real, linked Privacy Policy (the form currently just has a placeholder `#` link)
  and to honor do-not-call/opt-out requests.
- Consider having a lawyer familiar with insurance marketing review the form language and your
  calling practices before you launch.

## Customizing

- Edit form fields in `public/index.html` and the matching columns in `db.js` / `server.js`.
- Styling lives in `public/style.css` — update colors/branding there.
- Add authentication for multiple dashboard users, or swap Basic Auth for a real login system, if
  more than one person will use the dashboard.
