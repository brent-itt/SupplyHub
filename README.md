# SupplyHub

SupplyHub is a supplies portal for Panpacific University and the Supplies Office. Visitors can view selected public stock. Staff can view supplies, scan QR labels, and submit requisitions. Admins manage inventory, approvals, and reports. Super Admins also manage user access.

## Run locally

```sh
npm install
npm run dev
```

Open http://localhost:3000. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

## Connect Supabase

1. Create a Supabase project and run the migration files in `supabase/migrations` in timestamp order in its SQL Editor.
2. Disable public email sign-ups and create the first authorized account in Supabase Authentication.
3. Follow [`supabase/README.md`](supabase/README.md) to promote that account to Super Admin.
4. Copy `.env.example` to `.env.local` and set the Supabase URL and publishable key. Set `SUPABASE_SECRET_KEY` on the server to let Super Admins create accounts from the portal. Existing deployments can use `SUPABASE_SERVICE_ROLE_KEY` instead.
5. Restart the app and sign in. New staff/admin accounts are created only by Super Admins or directly in Supabase; access must be activated and assigned a role.

The first visit to a protected page opens `/setup` when the public Supabase settings are missing. Do not expose or commit a Supabase secret or service-role key.

## Deploy to Vercel

The Vercel project is `brent-itts-projects/supalies`, with production URL https://supplyhub-pu.vercel.app.

Vercel detects Next.js automatically and uses `npm run build`. Configure these variables for the Production environment in the Vercel project settings:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Your server-only Supabase secret key; `SUPABASE_SERVICE_ROLE_KEY` is also supported |
| `NEXT_PUBLIC_SITE_URL` | `https://supplyhub-pu.vercel.app` |

In Supabase **Authentication > URL Configuration**, set **Site URL** to `https://supplyhub-pu.vercel.app` and add `https://supplyhub-pu.vercel.app/auth/callback?next=%2Freset-password` to **Redirect URLs** for password recovery. Keep any localhost redirect needed for local development.

To deploy updates from this folder:

```sh
vercel deploy --prod --scope brent-itts-projects
```

On a new machine, run `vercel login` and `vercel link --project supalies --scope brent-itts-projects` first. The `.vercel` project link and `.env.local` remain local files. Changes to Vercel environment variables require a new deployment.

## Features

- Email and password sign-in, password reset, and pending account approval.
- Public home-page stock list curated by Admins and Super Admins.
- Role-based access for Super Admin, Admin, and Staff.
- Supply search and stock availability for signed-in staff.
- Supply creation, editing, archiving, restoration, and reports for managers; stock movements for Admins and Super Admins.
- Staff requisitions with manager approval and automatic audited stock deduction.
- Item QR labels and camera or manual-code scanning to open the corresponding inventory item.
- Current stock and transaction reports with CSV export and print layout.
- PostgreSQL row-level security and protected database functions for every write.

## Project files

- `src/app/(system)`: authenticated dashboard, inventory, requisitions, reports, QR scanner, account, and access pages.
- `src/app/actions.ts`: validated server actions for authentication and data changes.
- `src/lib`: auth, validation, QR, formatting, and Supabase helpers.
- `src/components/system`: shared dashboard and form components.
- `supabase/migrations`: database schema, row-level policies, and stock transaction functions.
- `pic`: supplied university logo, campus photo, and landing-page illustrations.

## Commands

```sh
npm run lint
npm run typecheck
npm run build
```
