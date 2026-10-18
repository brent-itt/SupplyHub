# Account email verification

New accounts created in **User access** require a syntactically valid email and confirmation of that inbox before sign-in. Account creation no longer auto-confirms email. A valid format alone does not establish that a mailbox exists; completing the emailed link establishes ownership. Administrator approval and email verification are separate requirements.

## Deployment

1. Apply `supabase/migrations/202610180001_require_verified_email.sql` in the Supabase SQL Editor. This enforces verification for protected database reads and RPCs as well as the application's own authorization checks.
2. Keep public sign-ups disabled. Enable **Confirm email** under Supabase Authentication's Email provider. This prevents password sign-in from issuing sessions before confirmation.
3. Configure Supabase Auth SMTP for delivery to your users. VIP Queue's application Gmail/Resend variables do not configure Supabase Auth mail. Supabase's default email service has recipient restrictions and is not suitable for general account creation.
4. Set `NEXT_PUBLIC_SITE_URL` to the deployed website's HTTPS origin. Set the same Site URL in Supabase **Authentication > URL Configuration** and allow `https://YOUR-SITE/verify-email?notice=check_sign_in` as a redirect. Use the corresponding localhost address for development.
5. Recommended: update **Confirm signup** under Auth email templates to use this link:

   ```html
   <h2>Verify your SupplyHub email</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Verify email address</a></p>
   ```

   The default `{{ .ConfirmationURL }}` template also works with the allowed redirect above. The verification page removes the returned URL fragment and sends the user to sign-in. Neither flow stores the confirmation session or replaces an administrator's existing session. The token-hash route also rejects recovery/invite token types and external redirect destinations.

Create an account with an inbox you control, verify that sign-in is blocked, open the confirmation link in a different browser, then sign in with the temporary password. Request a fresh link using **Resend verification email** for expired/missing emails. Supabase applies its email resend limits. No account is created by the resend action.

If email delivery or role assignment fails after creation, the account remains visible in User access. The error explains how to recover; do not create the same account again. A successful send request is not a guarantee of inbox delivery.

Existing accounts already marked confirmed retain that status. This change does not retroactively prove ownership of previously auto-confirmed addresses or reset their status.

Automated checks: `node --import tsx --test tests/email-verification.test.ts tests/verified-email-access.test.ts tests/auth-session.test.ts tests/session-cookies.test.ts`.

Provider references: [Resend confirmation](https://supabase.com/docs/reference/javascript/auth-resend), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), and [Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
