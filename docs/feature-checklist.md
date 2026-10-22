# SupplyHub feature checklist

Reviewed October 19, 2026. This records application support; production still needs the database migrations and email settings below.

| # | Requirement | Implementation and where to use it |
| --- | --- | --- |
| 1 | Show current stock items | **Inventory** (`/inventory`) lists items, quantities, status, category, and location. Stock movements update these records. |
| 2 | Analytics with dates | **Overview** (`/dashboard`) shows stock health, request status, seven days of dated stock movement, and a timestamp. **Reports** has date filters. Report and CSV boundaries use Philippine calendar days. |
| 3 | Student QR codes for updated stocks | Homepage category QR codes open public `/stock?category=…` pages. Pages fetch the selected public stock and refresh every 30 seconds while visible and online, with manual refresh and a timestamp. Only items selected for public display and their capped display quantities are exposed. |
| 4 | Scan barcodes against inventory | **Barcode stock out** (`/scan`) matches scans to stock codes, checks availability, and updates inventory after confirmation. |
| 5 | POS-style system | `/scan` has a supply catalog, cart, quantities, recipient and receipt details, checkout confirmation, retry protection, and printable receipts. It records supply issuance, not payment processing. |
| 6 | Default barcode | **Add supply item** pre-fills a generated `SUP-…` code. Staff can replace it with an existing product code. A new code is prepared after each successful creation; edits preserve existing codes. Open the saved item's page to print its Code 128 label. |
| 7 | Provide a barcode scanner | The app includes a camera scanner and keyboard-input support for USB/Bluetooth barcode readers. Camera scanning requires HTTPS and camera permission. Physical scanner hardware must be supplied separately. |
| 8 | Digital logs | **Student stock-out log**, requisition activity logs, and the transaction ledger record submissions, approvals, issuance, dates, and actors. Access is role-controlled. |
| 9 | Printed analytics | **Overview → Print analytics** prints charts, values, date range, snapshot time, and scope. **Reports → Print current page** prints the selected stock/ledger pages with dates. The browser print dialog can also save a PDF. |
| 10 | VIP / priority queue | **VIP Queue** (`/vip-queue`) shows overall and per-item positions, ready-to-collect quantities, reminder priority, and remaining balances. Earlier submissions receive stock priority. |
| 11 | Notify students when stock is available | Admins/Super Admins use **VIP Queue → Send reminder** to preview and send email. The server checks current queue status when preparing the message. Gmail SMTP and Resend are supported, with delivery records and duplicate-send protection. Sending remains manual, as requested. |

## Deployment

1. Apply migrations in timestamp order, including `supabase/migrations/202610190001_server_read_grants.sql`. This adds explicit `service_role` reads for the student form and staff analytics, including on fresh databases without automatic Supabase table grants.
2. Retain the existing email configuration in the deployment environment. See [Gmail reminders](gmail-reminders.md), or configure Resend as described in the main README. Local settings do not prove that production is configured.
3. Deploy the updated application with a production build.
4. Check one real student collection workflow: create an item, print and scan its label, receive stock, submit a student request, issue stock, inspect logs and analytics, and print the analytics.
5. For email verification, an authorized administrator should send a reminder to a consenting test recipient and confirm receipt. Automated tests use mocked delivery and do not email students.

## Validation

The tests cover printed barcode decoding, default stock-code validation, public-stock permissions, Philippine report-date boundaries, queue priority, POS retries, digital logs, and email preparation/delivery failure handling. Browser checks use fixture data for the changed forms, stock refresh, and analytics printing; they do not replace a production device and email-delivery check.
