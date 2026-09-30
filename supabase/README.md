# Database setup

1. Create a Supabase project and open **SQL Editor**.
2. Run `migrations/202609250001_supplies_system.sql` once, then run `migrations/202609270001_public_stock_no_students.sql`. Then run `migrations/202609270002_admin_only_stock_edits.sql` to restrict all stock edits to Admin and Super Admin. Apply all migrations in order. Existing Student profiles become inactive Staff profiles.
3. In **Authentication > Providers > Email**, disable public sign-ups. Create authorized university accounts in **Authentication > Users > Add user**. If you use invitations, configure the app URL and redirect allow list in **Authentication > URL Configuration**. The application uses password sign-in, so each account needs a password.
4. Edit the email in `bootstrap-first-admin.sql` and run that file in SQL Editor to activate the initial super admin. This bootstrap stops if an active super admin already exists.
5. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in the app's `.env.local` and Vercel environment variables. A legacy anon key is also suitable as the public key if the project has not adopted publishable keys. Set `SUPABASE_SECRET_KEY` as a server-only environment variable for Super Admin account creation (existing deployments can use `SUPABASE_SERVICE_ROLE_KEY`). Never place either privileged key in a `NEXT_PUBLIC_*` variable.
6. Sign in as the initial super admin. On **Users**, approve each account and assign Staff, Admin, or Super admin. Create supply records, then record initial stock through **Stock in** so the opening balance is included in history. On an item's detail page, select **Show on public list** to display it on the home page.

Accounts are inactive by default. Only an active super admin can approve accounts and change roles. Auth metadata such as `role` or `is_active` is ignored. There are no production demo accounts, sample balances, or automatic elevated users.

## Access rules

| Capability | Public visitor | Staff | Admin | Super admin |
| --- | --- | --- | --- | --- |
| View selected home-page stock | Yes | Yes | Yes | Yes |
| View full inventory and submit/cancel own requisitions | - | Yes | Yes | Yes |
| Record stock movements | - | - | Yes | Yes |
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
- `create_requisition(p_item_id, p_quantity, p_purpose)` returns the request UUID.
- `review_requisition(p_request_id, p_decision, p_note)` accepts `approved` or `rejected`.
- `cancel_requisition(p_request_id)` cancels the caller's pending request.
- `set_user_access(p_user_id, p_role, p_is_active)` assigns access.
- `set_item_public_visibility(p_item_id, p_show_on_landing)` controls whether an item appears on the public home page.

QR labels identify an item, not a credential or authorization token. Scanning must resolve the item in the current authenticated session; any resulting movement uses the same protected `stock_movement` RPC.

## Verification

Run `node --test tests/database.test.mjs` from the project root after installing dependencies. The suite executes the actual migration in PGlite (PostgreSQL in a local process), with minimal Supabase Auth stubs. It tests database permissions, row visibility, role escalation, stock arithmetic/rollback, adjustment audit entries, idempotency, and requisition processing. It does not replace a final smoke test against your deployed Supabase project's authentication configuration or a multi-connection load test.

