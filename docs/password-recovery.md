# Password reset email setup

Set `NEXT_PUBLIC_SITE_URL` to the app's actual origin. In Supabase **Authentication > URL Configuration**, use the same Site URL and allow this redirect (substitute your domain):

```text
https://YOUR-SITE/auth/callback?next=%2Freset-password
```

For local development use `http://localhost:3000/auth/callback?next=%2Freset-password`. A localhost email link must be opened on the computer running the app. Use a deployed HTTPS origin for other devices.

The **Reset password** email template can use the default link:

```html
<a href="{{ .ConfirmationURL }}">Reset password</a>
```

New reset requests use a stateless Auth client so the email can be opened in a different browser. Supabase's default template returns the recovery session in a URL fragment; the callback removes the URL credentials, verifies the session with Auth, writes session cookies, then loads `/reset-password`. No password update is authorized solely by URL parameters. Existing PKCE links are still supported in the browser that requested them.

Alternatively, use a direct recovery token-hash link to avoid returning session tokens in a URL fragment:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

Keep signup verification at `/auth/confirm`; that endpoint deliberately does not accept recovery tokens. Supabase Auth SMTP settings control reset mail delivery. A send failure now displays an error instead of claiming a reset link was sent. Unknown addresses retain the same generic success response.

After deploying, request a fresh reset email, open the newest link in a different browser, set a new password, and verify password sign-in. Also check a reused/expired link returns to the reset request form with an explanation. Old links missing their PKCE cookie cannot be repaired; request a fresh email.

Automated checks: `node --import tsx --test tests/password-recovery.test.ts tests/auth-session.test.ts tests/session-cookies.test.ts tests/email-verification.test.ts`.

References: [Supabase password recovery](https://supabase.com/docs/guides/auth/passwords), [implicit flow](https://supabase.com/docs/guides/auth/sessions/implicit-flow), and [PKCE browser requirements](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

## Changing a password in My account

The user first requests a verification code, then enters the emailed code, new password, and matching confirmation. SupplyHub uses the server's Supabase secret/service-role key to generate a recovery OTP for the authenticated user's verified email, and the existing `EMAIL_PROVIDER` Gmail/Resend configuration to send it. Neither the code nor the generated recovery link is returned to the browser. No database migration or Supabase email-template change is required.

The server checks the account is active, restricts resends using Auth's recovery timestamp (one minute), rejects codes older than ten minutes, and calls Supabase `verifyOtp` before updating the password. Supabase consumes the code on verification, including when a subsequent password update fails; those failures require a fresh code. Requests overlap with the forgot-password flow because both use Auth's recovery tokens, so use the newest code or email. Concurrent send requests may race against the timestamp check; Supabase's verification limits still apply.

The reset-link page and action also require recent, verified OTP/recovery claims; a normal password login cannot use that app action to skip the email step. This is an application workflow, not a replacement for Supabase's provider-level password security settings. Supabase's own secure-password-change setting allows recently signed-in sessions to update passwords without reauthentication; adding a nonce field alone would not enforce verification on every account-form submission. See [Supabase's password update implementation](https://github.com/supabase/auth/blob/master/internal/api/user.go).

Checks: `node --import tsx --test tests/account-password.test.ts tests/password-recovery.test.ts tests/auth-session.test.ts tests/session-cookies.test.ts tests/email-verification.test.ts`.
