# SupplyHub: Hosting and System Access Handover

**System:** SupplyHub: A Web-Based School Supplies Office Management System  
**Institution:** Panpacific University  
**Prepared for:** Instructor / IT Department  
**Prepared:** October 21, 2026  
**Submission:** October 25, 2026  
**Required availability:** Through November 25, 2026, inclusive (Asia/Singapore, UTC+08:00)  
**Status:** Prepared for owner completion. Missing credentials and hosting coverage must be confirmed before submission.

## 1. Application access

SupplyHub manages supply inventory, requisitions, barcode issuance, student collection requests, waiting queues, and reports. Students can use its public pages; protected functions require an active, email-verified account with the appropriate role.

| Access point | Address / instructions |
| --- | --- |
| Public application | https://supplyhub-pu.vercel.app |
| Staff and administrator sign-in | https://supplyhub-pu.vercel.app/login |
| Student collection request | https://supplyhub-pu.vercel.app/form |
| Stock availability | Open the homepage and scan a category QR code. Category pages use /stock?category=CATEGORY. |
| Protected dashboard | https://supplyhub-pu.vercel.app/dashboard |
| Requirements | Internet connection and a current web browser. Camera scanning requires camera permission and HTTPS. No separate application installation is required. |

To sign in, open the login address and enter the assigned email and password. A Super Admin must activate the account after email verification. Public sign-up is disabled. Students do not need an account for public stock information or the collection form.

## 2. Hosting and infrastructure

| Component | Recorded information |
| --- | --- |
| Web hosting provider | Vercel |
| Vercel dashboard | https://vercel.com/brent-itts-projects/supalies |
| Vercel project / scope | supalies / brent-itts-projects |
| Vercel project ID | prj_o20Gj3bw1lUlXTMB88bJotzAd4Ov |
| Vercel team ID | team_Tvc3IFidmqj8DenHo2PQZVBV |
| Vercel account | brent-itt; brent.delacruz.ecoast@panpacificu.edu.ph (verified through authenticated CLI) |
| Vercel subscription | Hobby; billing status active on October 21, 2026 |
| Framework / runtime | Next.js; configured hosting runtime Node.js 24.x |
| Build / root | npm run build; repository root; default Next.js output |
| Public address | supplyhub-pu.vercel.app; no separate custom domain is documented |
| Database and authentication | Supabase / PostgreSQL |
| Supabase project reference | jqwlnkdisosvwdyhqhka (from local configuration; confirm production value in Vercel) |
| Supabase dashboard | https://supabase.com/dashboard/project/jqwlnkdisosvwdyhqhka |
| Supabase API URL | https://jqwlnkdisosvwdyhqhka.supabase.co |
| Supabase plan / region | [Owner to confirm in dashboard] |
| Source repository | https://github.com/brent-itt/SupplyHub.git |
| Application email | Gmail is selected locally; sender nova071505@gmail.com. Production Gmail variable names are present; their values and delivery were not checked. |

Vercel hosts the application; Supabase provides its database and sign-in service. Both must remain available for the system to operate. Application email supports reminders and account password-change codes. Supabase Auth SMTP separately handles email verification and password-reset links.

## 3. Account and credential register

Complete the fields below in the restricted handover copy or provide a password-manager reference that the recipient can open. No passwords, API secrets, or recovery codes are embedded in this document. Existing passwords cannot be recovered from the source code. Do not treat a provider account as an application login.

| Account | Login / identity | Password or secure handover reference |
| --- | --- | --- |
| SupplyHub Super Admin | [Assigned email required] | [Required; test sign-in before submission] |
| SupplyHub Admin / evaluator | [Assigned email and role required] | [Required if supplied for evaluation] |
| SupplyHub Staff / evaluator | [Assigned email required, if staff workflow is evaluated] | [Required if supplied for evaluation] |
| Vercel hosting administrator | brent-itt / brent.delacruz.ecoast@panpacificu.edu.ph | [Confirm login method, recipient access, and recovery contact] |
| Supabase project owner | brent.delacruz.ecoast@panpacificu.edu.ph (owner supplied); organization: [confirm] | [Confirm login method, project access, and recovery contact] |
| GitHub repository maintainer | Repository owner: brent-itt; recipient: [required] | [Confirm collaborator access and account recovery] |
| Gmail sending account | nova071505@gmail.com, local configuration only | [Confirm production sender and authorized access; app password stored in environment configuration] |
| Database maintenance connection | [Copy connection details from Supabase dashboard] | [Database password / vault reference; needed for direct backup or migration tools] |
| Supabase Auth SMTP provider | [Provider and sender required] | [SMTP credential reference; configured separately in Supabase] |

**System custodian / maintenance contact:** Brent Dela Cruz  
**Support email:** brentdelacruz021@gmail.com  
**Hosting owner university email:** brent.delacruz.ecoast@panpacificu.edu.ph  
**Support phone:** [Optional contact number]  
**Backup custodian:** [Name and contact details]  
**Credential recipient and delivery date:** Instructor / IT Department; named recipient and delivery date: [required]  
**Recovery method / MFA custodian:** [Account-specific recovery arrangements]

Staff can view inventory, submit requisitions, and issue stock. Admins also manage inventory, approvals, reports, and the VIP Queue. Super Admins additionally manage user access. Use an existing Super Admin to assign access; the initial bootstrap SQL is only for first setup when no active Super Admin exists.

## 4. Configuration required to operate the system

Production variables are managed in the Vercel project's environment settings. Local development uses .env.local. The following production variable names were confirmed on October 21; encrypted values were not retrieved or compared with local values.

| Variable | Purpose / expected configuration |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Production Supabase project URL; verify it matches the intended project. |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Public client API key for that project. |
| SUPABASE_SERVICE_ROLE_KEY | Existing server-only privileged key. The app also supports SUPABASE_SECRET_KEY as an alternative. |
| NEXT_PUBLIC_SITE_URL | Expected production value: https://supplyhub-pu.vercel.app. Local configuration currently uses http://localhost:3000. |
| EMAIL_PROVIDER | Expected gmail for the configured Gmail workflow; local value is gmail. |
| GMAIL_USER | Sending mailbox; confirm production value. |
| GMAIL_APP_PASSWORD | Gmail app password for SMTP; distinct from the normal Google account password. |

GMAIL_REPLY_TO_EMAIL is optional and was not listed in production. If switching to Resend, configure EMAIL_PROVIDER=resend, RESEND_API_KEY, RESEND_FROM_EMAIL, and optionally RESEND_REPLY_TO_EMAIL. Secret values belong in server configuration and the restricted credential handover, never public source files.

In Supabase Authentication, keep public sign-ups disabled, enable email confirmation, and configure Auth SMTP. Set the Site URL to the production origin. Allow the following redirects:

- https://supplyhub-pu.vercel.app/verify-email?notice=check_sign_in
- https://supplyhub-pu.vercel.app/auth/callback?next=%2Freset-password

Gmail reminder settings do not configure Supabase Auth mail. The local Gmail transport uses smtp.gmail.com, port 587, with STARTTLS. A working home page does not verify email delivery or protected database operations.

## 5. Deployment, recovery, and maintenance

1. Obtain repository access and the project environment configuration. Use the repository lockfile to install dependencies with npm ci. On Windows, use npm.cmd if PowerShell blocks npm.ps1.
2. Review the Next.js guides in node_modules/next/dist/docs before changing application code, as required by AGENTS.md.
3. Back up the database before schema changes. Review applied migrations and apply only outstanding files from supabase/migrations in timestamp order. The latest migration present at preparation is 202610190001_server_read_grants.sql; its production application was not verified.
4. Run npm run lint, npm run typecheck, npm run build, and relevant tests. Follow README.md and the guides under docs for the changed feature.
5. For an authorized production release, authenticate with Vercel and link the checkout if needed: vercel link --project supalies --scope brent-itts-projects. Deploy with vercel deploy --prod --scope brent-itts-projects. Redeploy after changing environment variables.
6. Verify the homepage, public stock, student form, authorized sign-in, reports, and the affected workflow. Test email only with an intended test recipient. Record the deployment and verification date.
7. If a release fails, restore a known working Vercel deployment. Application rollback does not undo database migrations; use a compatible database recovery plan.

**Database backup location / date:** [Required]  
**Backup retention and restore procedure:** [Required]  
**Last successful restore check:** [Required]  
**Last known working deployment:** [Record Vercel deployment URL / ID]

Use Vercel deployment/runtime logs for application failures and Supabase service logs for database or authentication failures. For sign-in issues, check email verification, account activation, and assigned role. For email issues, check the relevant provider configuration and delivery logs. Inventory CSV reports are useful records but are not a complete database backup.

## 6. Hosting validity: October 25 to November 25, 2026

The required coverage ends on November 25, 2026, inclusive. Current reachability and an active subscription status do not establish future availability. This document does not certify that the one-month requirement has already been fulfilled.

Vercel's Hobby plan has no billing cycle, but continued availability remains subject to its limits and account status. Supabase Free projects can pause for low activity over seven days; paid-plan projects are not subject to automatic inactivity pausing. The Supabase plan has not been verified. Confirm its coverage before signing the commitment below. See the official provider references in section 8.

Before submission, the hosting owner must:

- Confirm both projects are active and record the Supabase plan and organization.
- Confirm any subscriptions, trials, payments, and email-provider access remain valid through November 25. If uninterrupted availability requires a plan change, the owner must arrange it.
- Keep the deployment, database, required credentials, and evaluator accounts available throughout the period.
- Check application and database health regularly, review provider notices, and respond to service interruptions. Monitoring alone is not a guarantee against free-plan pausing.
- Attach dated dashboard evidence of account/project status and any applicable coverage or renewal evidence, then complete the credential register.

**Hosting owner commitment (complete after verification):** I, Brent Dela Cruz, undertake to maintain the SupplyHub application, database, and required access from October 25, 2026 through November 25, 2026, inclusive, and to address service or account issues during this period.

**Owner signature / date:** [Required]  
**Supabase plan / status / coverage evidence:** [Required]  
**Vercel status / coverage evidence:** [Required]  
**Next renewal date(s), or not applicable with reason:** [Required]  
**Recipient acceptance / date:** [Required]

## 7. Verification record and remaining items

| Check on October 21, 2026 | Result |
| --- | --- |
| Public homepage, /login, and /form | HTTP 200; no setup redirect observed. |
| /stock without a category | Redirected to the homepage's available-stock section; HTTP 200. |
| Vercel project and account | Verified through authenticated Vercel CLI. |
| Vercel plan | Hobby; active billing status reported by Vercel API. |
| Production environment variables | Seven required/configured names listed; values not inspected. |
| Application account credentials | Not supplied or tested. |
| Supabase owner | Email supplied by the owner; dashboard access not tested. |
| Supabase plan, billing, backups, and migrations | Not verified. |
| End-to-end database operations and email delivery | Not tested during document preparation. |
| One-month coverage | Owner confirmation and evidence outstanding. |

## 8. Supporting references

Project sources: README.md, .env.example, .vercel/project.json, supabase/README.md, docs/email-verification.md, docs/password-recovery.md, docs/gmail-reminders.md, and docs/feature-checklist.md. Local settings are evidence of development configuration only. Live metadata was obtained using authenticated Vercel read operations; public availability was checked with HTTP requests.

- Vercel Hobby plan and billing: https://vercel.com/docs/plans/hobby
- Supabase project pausing: https://supabase.com/docs/guides/platform/free-project-pausing

Store the completed credential register and any confidential attachments with authorized recipients. This repository copy contains no secret values. Do not commit a copy after filling in passwords or recovery codes.
