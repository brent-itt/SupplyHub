# Database setup

Apply `migrations/202610190001_server_read_grants.sql` after the earlier migrations. It explicitly grants server-side reads of `items` and `transactions` for the student form and staff analytics, so fresh databases work without automatic Supabase table grants. It is safe to rerun and does not grant anonymous access or direct stock writes.

1. Create a Supabase project and open **SQL Editor**.
2. Apply all files in `migrations` in timestamp order, including `202610040001_staff_stock_out.sql` (direct Staff stock out), `202610040002_school_staff_requisitions.sql` (revised school staff requisitions), and `202610040003_requisition_edits_and_logs.sql` (pending edits and admin activity logs). Receiving stock and count adjustments remain restricted to Admin and Super Admin. Existing Student profiles become inactive Staff profiles.
3. In **Authentication > Providers > Email**, disable public sign-ups. Create authorized university accounts in **Authentication > Users > Add user**. If you use invitations, configure the app URL and redirect allow list in **Authentication > URL Configuration**. The application uses password sign-in, so each account needs a password.
4. Edit the email in `bootstrap-first-admin.sql` and run that file in SQL Editor to activate the initial super admin. This bootstrap stops if an active super admin already exists.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the app's `.env.local` and Vercel environment variables. A legacy anon key is also suitable as the public key if the project has not adopted publishable keys. Set `SUPABASE_SECRET_KEY` as a server-only environment variable for Super Admin account creation (existing deployments can use `SUPABASE_SERVICE_ROLE_KEY`). Never place either privileged key in a `NEXT_PUBLIC_*` variable.
6. Sign in as the initial super admin. On **Users**, approve each account and assign Staff, Admin, or Super admin. Create supply records, then record initial stock through **Stock in** so the opening balance is included in history. On an item's detail page, under **Public stock list**, choose **Show on public list**, enter the **Displayed quantity**, and select **Save public display**.

Accounts are inactive by default. Only an active super admin can approve accounts and change roles. Auth metadata such as `role` or `is_active` is ignored. There are no production demo accounts, sample balances, or automatic elevated users.

Accounts created in the application's **User access** screen remain inactive and show **Pending email verification** until the owner confirms their inbox. A super admin can then activate the account. Apply `202610180001_require_verified_email.sql` followed by `202610180002_pending_account_verification.sql`, and follow [email verification setup](../docs/email-verification.md) to configure Auth SMTP and site/redirect URLs. The second migration deactivates unconfirmed accounts; previously confirmed accounts keep their existing status.

## Access rules

| Capability | Public visitor | Staff | Admin | Super admin |
| --- | --- | --- | --- | --- |
| View selected home-page stock | Yes | Yes | Yes | Yes |
| View full inventory | - | Yes | Yes | Yes |
| Submit school staff requisitions | - | Yes | - | - |
| Edit pending requisitions | - | Own requests | All requests | All requests |
| Read requisition activity logs | - | - | Yes | Yes |
| Stock out / issue supplies | - | Yes | Yes | Yes |
| Receive stock and adjust counts | - | - | Yes | Yes |
| View all requisitions and transaction history | - | - | Yes | Yes |
| Create/edit/archive supplies and curate public list | - | - | Yes | Yes |
| Approve/reject requisitions; reports | - | - | Yes | Yes |
| Approve accounts and assign roles | - | - | - | Yes |

## Integrity and RPCs

The database stores integer quantities in each item's unit. `stock_movement` accepts a positive quantity for `stock_in`/`stock_out`; for `adjustment`, the quantity is the desired new total and a reason is mandatory. The client must keep the same `p_idempotency_key` when retrying a movement. The database returns the original transaction for a matching retry and rejects reuse with a different payload, item, or actor.

Stock changes lock the item before reading its balance. Approvals lock the requisition and item in one transaction, check current stock, subtract the approved quantity, append a ledger entry, and mark the request processed. A second approval cannot subtract stock twice. Failed changes roll back entirely. Transaction history cannot be updated or deleted; use an adjustment to correct inventory.

Supplies can be archived only at zero stock with no pending requisitions. Archiving retains history. Account changes are serialized, and a super admin cannot disable or demote their own account. Deleting an auth user with a profile/history is restricted; deactivate the account to preserve audit attribution.

All application mutations use these public functions:

- `upsert_item(p_id, p_sku, p_name, p_description, p_category, p_unit, p_location, p_low_stock_threshold)` returns the item UUID; use null ID to create.
- `stock_movement(p_item_id, p_kind, p_quantity, p_note, p_reference, p_idempotency_key)` returns the ledger UUID.
- `archive_item(p_item_id, p_archived)` archives/restores an item.
- `create_requisition(p_item_id, p_quantity, p_purpose, p_requester_name, p_request_date)` returns the request UUID. Only active Staff may submit. The database derives item name/code from the inventory record and retains the caller as `requester_id`, separately from the entered school staff requestor name. The request date does not replace the submission timestamp.
- `update_requisition(p_request_id, p_item_id, p_quantity, p_purpose, p_requester_name, p_request_date, p_expected_version)` edits pending requests. Staff can edit their own; managers can edit any. It preserves the original recorder and never changes stock.
- `review_requisition(p_request_id, p_decision, p_note, p_expected_version)` accepts `approved` or `rejected`. Edits and reviews reject stale versions so a reviewer cannot issue an unseen edited quantity.
- `cancel_requisition(p_request_id)` cancels the caller's pending request.
- `set_user_access(p_user_id, p_role, p_is_active)` assigns access.
- `set_item_public_visibility(p_item_id, p_show_on_landing, p_public_quantity)` controls visibility and the maximum quantity shown on the public home page, without changing actual inventory.

Barcode labels encode the existing item SKU using Code 128. The barcode stock-out cart uses the protected `stock_movement` RPC for each line, retaining a unique idempotency key and a shared POS reference across retries. Lines are committed separately: the screen identifies any completed lines if a later line fails, and retrying does not issue confirmed stock twice. Active Staff, Admin, and Super Admin can confirm stock out after applying `migrations/202610040001_staff_stock_out.sql`. Staff cannot receive stock, adjust counts, edit supplies, or approve requisitions.

## Verification

### Public display quantities

Apply [`202610040007_public_display_quantity.sql`](migrations/202610040007_public_display_quantity.sql) before deploying the updated application. Admins can save a separate displayed quantity for each item under **Inventory > item > Public stock list**. The landing page uses `get_public_stock()` to return only selected, active items with the smaller of actual stock and the configured display limit. Zero displays as out of stock. Stock movements continue to use actual inventory. Anonymous callers can no longer read the actual `items.quantity` column directly.

Existing items start with their current stock count as their display limit; new items default to zero and hidden. Adjust existing limits after migration. Rerunning this migration preserves saved limits. Run `npx tsx --test tests/public-stock.test.ts` to verify validation, permissions, hidden/archived filtering, stock changes, migration retry, and the separation of public and actual quantities.

### Student forms and stock-out logs

For direct email reminders, apply [`202610150002_vip_email_reminders.sql`](migrations/202610150002_vip_email_reminders.sql) after the VIP Queue migration. Configure `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and optionally `RESEND_REPLY_TO_EMAIL` on the application server. The sender must belong to a verified Resend domain. For Gmail SMTP instead, apply `202610150003_gmail_reminders.sql` next and follow [the Gmail setup guide](../docs/gmail-reminders.md). Supabase Auth mail settings do not control these reminders.

**Send reminder**, beside **Review submission**, previews the student's collection status and allows an administrator to fill a missing email. The server checks the current queue entry and active admin role before preparing an email. Stock and priority are unchanged. A private `student_vip_reminders` record freezes the message and recipient so retries retain the same Resend idempotency key and body. Pending attempts resume across refreshes; accepted reminders suppress another send for five minutes. Unconfirmed attempts older than 23 hours require checking Resend and reconciling their delivery record before another send, because provider idempotency expires after 24 hours. `accepted_at` means accepted by Resend, not confirmed inbox delivery. Only the server key can prepare or complete reminder records; managers may read the audit history.

Apply [`202610150001_student_vip_queue.sql`](migrations/202610150001_student_vip_queue.sql) once after student migrations `005` and `006` to enable email collection, partial issuance, and VIP priority. Run the entire file in the connected project's SQL Editor before using the updated app. Application API keys cannot apply schema migrations.

- New student forms require an email. Older submissions keep a null email; no address is invented for existing students.
- A request for 10 with only 3 available enters VIP Queue. Staff scans the requested barcode, confirms 3, and the remaining 7 stay pending in the queue. Zero-stock requests enter the queue immediately without a stock transaction. Existing shortages are backfilled, and later inventory reductions also queue affected pending submissions.
- VIP balances reserve incoming stock by original submission time and ID, separately for each item. Direct stock out and requisition approval can use only the surplus after reservations. Physical count adjustments remain available to admins. Archived items cannot be issued.
- `/vip-queue` is an Admin/Super Admin page showing email, receipt, item, requested/issued/remaining quantities, per-item position, and the amount available for collection. The email link opens the operator's mail app. The separate Send reminder action sends through the selected Gmail or Resend provider after configuring the reminder migration and server settings above. There are no background or bulk reminders.
- Each collection has its own immutable transaction and retry key in `student_stock_out_issues`. Retrying the same collection cannot deduct twice, including after subsequent collections. A request stays `pending` until fully issued. Rejecting a partly issued request closes only its unfilled balance and preserves earlier transactions.
- Run `node --import tsx --test tests/vip-queue.test.ts tests/student-stock-out.test.ts tests/stock-out.test.ts` for database and validation coverage. PGlite tests serialize transactions; they do not replace a multi-connection load test against Supabase.

Apply [`202610040005_student_stock_out_logs.sql`](migrations/202610040005_student_stock_out_logs.sql) after the core schema and Staff stock-out migration `202610040001`. Existing installations should run this new migration once; it does not require rerunning earlier migrations. Configure the existing server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` so the public form can load item names and submit through the restricted RPC.

- `/form` is public and requires no student account. It collects full name, email, date, receipt number, item, and quantity. Students receive a confirmation reference and a summary of their own submission.
- `/student-logs` is available to active Staff, Admin, and Super Admin. It shows pending submissions by default, with search, status filters, pagination, and a 30-second refresh. Students cannot read the log table or call the processing RPC.
- Apply [`202610040006_student_barcode_checkout.sql`](migrations/202610040006_student_barcode_checkout.sql) after migration `005` to require barcode verification. **Confirm & scan barcode** opens `/scan?student_log=...` with the saved name, date, and receipt number. The entry stays pending and stock does not change at this step. Scan the requested item to add the quantity currently available for that student, then complete checkout. Catalog clicks cannot replace the scan in this flow.
- Barcode checkout verifies the current item code and VIP reservations in PostgreSQL, records a stock transaction and scanned barcode, and updates the student log in one transaction. Wrong codes or failed issuance leave the entry pending. Repeating a completed checkout returns the original result without issuing stock twice. Rejection requires a reason and does not change inventory.
- Submission records retain the original item details, server submission timestamp, receipt date, processing account/name, decision time, staff note, and transaction ID. Client roles cannot directly insert, update, or delete these logs.
- `/student-logs/qr` generates a printable poster and downloadable QR. Set `NEXT_PUBLIC_SITE_URL` to the deployed website address, or enter an address on the QR page. A phone cannot reach this computer using `localhost`; local phone testing needs a LAN address, a server listening on that interface, and the same network. Changing the poster address does not deploy the site.
- The public action uses a honeypot and a database limit of 60 new submissions per five minutes per hashed client address on Vercel. Local/self-hosted environments share one bucket rather than trusting forwarded headers. Raw addresses are not stored, and expired counters are removed after one day when another submission arrives. Repeated submissions using the same form token do not consume the quota or create duplicates.

Run `npx tsx --test tests/student-stock-out.test.ts` to check QR decoding, field validation, privacy, role permissions, submission retries, confirmation/rejection, stock rollback, audit attribution, and throttling against PostgreSQL in PGlite.

Barcode checkout requires the recipient name, receipt number, and receipt date (defaulting to the university's current date). Each issued line saves these details with the purpose in its existing transaction `note`; the internal POS reference remains the checkout identifier. Details are locked after confirmation and retained across retries, and the completed receipt includes them when printed. No additional database migration is needed for these receipt fields. Report date filters still use the actual recording timestamp.

### Repair missing requisition columns

If submitting a requisition reports `column "requester_name" of relation "requisitions" does not exist`, the newer RPC was installed without its table fields. Run the entire [`202610040004_requisition_rpc_compat.sql`](migrations/202610040004_requisition_rpc_compat.sql) file in the connected project's **SQL Editor**, then submit again. This repair adds the four missing fields, fills historical records while preserving existing metadata, restores field constraints, removes the obsolete submission endpoint, and refreshes the API schema cache. It is transactional and safe to rerun. If edit/log migration `202610040003` is already installed, do not rerun it or migration `202610040002`; apply this repair instead.

The app's publishable and service-role keys cannot execute schema migrations. Apply this SQL through the Supabase dashboard or an authenticated database migration connection.

Run `npx tsx --test tests/requisition-repair.test.ts` to reproduce the missing-column error and verify repair, partial metadata preservation, repeat execution, submission, editing, approval, and activity logs.

`requisition_logs` records new submissions, edits, approvals, rejections, and cancellations through database triggers. Only active Admin and Super Admin can read it; application users cannot insert, edit, or delete log entries. Entries retain actor names and before/after request snapshots. Historical activity before this migration is not reconstructed. The admin Requisitions page offers per-request filtering and paginated logs. Run `npx tsx --test tests/requisition-logs.test.ts` to verify ownership, closed-request locking, version conflicts, log visibility, immutable records, and rollback on failed approval.

Run `npx tsx --test tests/requisitions.test.ts` to verify the latest requisition migration, historical record backfill, field validation, Staff-only submission, approval permissions, and direct stock out without creating a requisition.

Run `node --test tests/stock-edit-access.test.mjs` and `npx tsx --test tests/stock-out.test.ts` from the project root after installing dependencies. These suites execute all current migrations in PGlite (PostgreSQL in a local process), with minimal Supabase Auth stubs. They verify Staff stock-out permissions, restrictions on other stock operations, stock balances, audit attribution, and safe checkout retries. They do not replace a final smoke test against your deployed Supabase project's authentication configuration or a multi-connection load test.

