# Database setup

1. Create a Supabase project and open **SQL Editor**.
2. Apply all files in `migrations` in timestamp order, including `202610040001_staff_stock_out.sql` (direct Staff stock out), `202610040002_school_staff_requisitions.sql` (revised school staff requisitions), and `202610040003_requisition_edits_and_logs.sql` (pending edits and admin activity logs). Receiving stock and count adjustments remain restricted to Admin and Super Admin. Existing Student profiles become inactive Staff profiles.
3. In **Authentication > Providers > Email**, disable public sign-ups. Create authorized university accounts in **Authentication > Users > Add user**. If you use invitations, configure the app URL and redirect allow list in **Authentication > URL Configuration**. The application uses password sign-in, so each account needs a password.
4. Edit the email in `bootstrap-first-admin.sql` and run that file in SQL Editor to activate the initial super admin. This bootstrap stops if an active super admin already exists.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the app's `.env.local` and Vercel environment variables. A legacy anon key is also suitable as the public key if the project has not adopted publishable keys. Set `SUPABASE_SECRET_KEY` as a server-only environment variable for Super Admin account creation (existing deployments can use `SUPABASE_SERVICE_ROLE_KEY`). Never place either privileged key in a `NEXT_PUBLIC_*` variable.
6. Sign in as the initial super admin. On **Users**, approve each account and assign Staff, Admin, or Super admin. Create supply records, then record initial stock through **Stock in** so the opening balance is included in history. On an item's detail page, select **Show on public list** to display it on the home page.

Accounts are inactive by default. Only an active super admin can approve accounts and change roles. Auth metadata such as `role` or `is_active` is ignored. There are no production demo accounts, sample balances, or automatic elevated users.

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
- `set_item_public_visibility(p_item_id, p_show_on_landing)` controls whether an item appears on the public home page.

Barcode labels encode the existing item SKU using Code 128. The barcode stock-out cart uses the protected `stock_movement` RPC for each line, retaining a unique idempotency key and a shared POS reference across retries. Lines are committed separately: the screen identifies any completed lines if a later line fails, and retrying does not issue confirmed stock twice. Active Staff, Admin, and Super Admin can confirm stock out after applying `migrations/202610040001_staff_stock_out.sql`. Staff cannot receive stock, adjust counts, edit supplies, or approve requisitions.

## Verification

### Student forms and stock-out logs

Apply [`202610040005_student_stock_out_logs.sql`](migrations/202610040005_student_stock_out_logs.sql) after the core schema and Staff stock-out migration `202610040001`. Existing installations should run this new migration once; it does not require rerunning earlier migrations. Configure the existing server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` so the public form can load item names and submit through the restricted RPC.

- `/form` is public and requires no student account. It collects full name, date, receipt number, item, and quantity. Students receive a confirmation reference and a summary of their own submission.
- `/student-logs` is available to active Staff, Admin, and Super Admin. It shows pending submissions by default, with search, status filters, pagination, and a 30-second refresh. Students cannot read the log table or call the processing RPC.
- Apply [`202610040006_student_barcode_checkout.sql`](migrations/202610040006_student_barcode_checkout.sql) after migration `005` to require barcode verification. **Confirm & scan barcode** opens `/scan?student_log=...` with the saved name, date, and receipt number. The entry stays pending and stock does not change at this step. Scan the requested item to add its submitted quantity, then complete checkout. Catalog clicks cannot replace the scan in this flow.
- Barcode checkout verifies the current item code in PostgreSQL, calls the protected stock movement function, records the scanned barcode, and updates the student log in one transaction. Wrong codes or failed issuance leave the entry pending. Repeating a completed checkout returns the original result without issuing stock twice. Rejection requires a reason and does not change inventory.
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

