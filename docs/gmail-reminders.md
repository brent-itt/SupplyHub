# Gmail SMTP for VIP reminders

1. Sign into the Gmail account that will send reminders. Enable **2-Step Verification** in [Google Account Security](https://myaccount.google.com/security).
2. Open [App Passwords](https://myaccount.google.com/apppasswords), create one named **SupplyHub**, and copy it into `.env.local`. Use the generated App Password, not the normal account password. App Passwords may be unavailable for managed accounts or Advanced Protection; see [Google's instructions](https://support.google.com/accounts/answer/185833).
3. Fill in the server-only settings:

   ```dotenv
   EMAIL_PROVIDER=gmail
   GMAIL_USER=your-office-account@gmail.com
   GMAIL_APP_PASSWORD=your-generated-app-password
   # Optional address to receive student replies:
   GMAIL_REPLY_TO_EMAIL=
   ```

   Spaces in the generated App Password are removed automatically. Keep secrets out of `.env.example` and source control. Existing Resend settings are ignored while `EMAIL_PROVIDER=gmail`.
4. Run `supabase/migrations/202610150003_gmail_reminders.sql` in Supabase SQL Editor **after** migrations `202610150001` and `202610150002`. This adds provider tracking and prevents overlapping SMTP sends.
5. Restart the app. For development: `npm run dev`. For a production server: `npm run build`, then `npm run start`. On hosting, set these same environment variables there and redeploy.
6. Refresh **VIP Queue**, open **Send reminder**, check the recipient and preview, then click **Send email reminder**. A successful response means Gmail accepted the message; it does not confirm inbox delivery. Check the recipient inbox/spam folder.

The app uses Nodemailer with `smtp.gmail.com`, port **587**, and mandatory STARTTLS with certificate verification. The sender is `SupplyHub <GMAIL_USER>`. No Resend domain verification is needed for this path. These are application reminders; Supabase Auth SMTP settings are separate. Reminders are sent only after an administrator clicks the button.

## Troubleshooting

- **Gmail sign-in failed:** check the full Gmail address, App Password, and 2-Step Verification. Google revokes App Passwords after the account password changes. Restart after changing environment variables.
- **Database setup required:** apply all three reminder/queue migrations in order and refresh the page.
- **Gmail rejected the reminder:** check the recipient and account sending limits. A definite rejection allows retrying.
- **Delivery unconfirmed:** another send is blocked because a disconnected SMTP session may already have delivered the message. Check Gmail Sent and the recipient before retrying. Unlike Resend, SMTP has no idempotency API. A repeated Message-ID alone does not prevent duplicates.

## Reconciling an uncertain Gmail attempt

An administrator can inspect `public.student_vip_reminders` in Supabase SQL Editor. Filter `provider = 'gmail'`, `accepted_at is null`, and `smtp_claim is not null`. The email Message-ID is `<vip-reminder.REMINDER_UUID@supplyhub.local>`.

After confirming delivery in Gmail Sent, record it using `public.complete_student_vip_reminder(reminder_uuid, message_id)`. If you have confirmed the send failed and no server request is still running, release the saved claim with `public.release_student_gmail_reminder(reminder_uuid, smtp_claim_uuid)`, then retry from the app. Do not release an unresolved attempt solely because it is old. These functions require the database owner or server service role.

Before switching providers, reconcile any uncertain sends in the old provider. Failed Resend preparations retain their audit history; Gmail creates its own message with the Gmail sender. Recent accepted reminders suppress another send for five minutes across providers.
