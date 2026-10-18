"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "./action-form";
import type { ActionResult, FormAction } from "@/lib/types";

export function AccountPasswordForm({ requestCode, updatePassword }: { requestCode: () => Promise<ActionResult>; updatePassword: FormAction }) {
  const [codeSent, setCodeSent] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [requestState, sendCode, sending] = useActionState(async () => {
    const result = await requestCode();
    if (result.success) { setCodeSent(true); setCompleted(false); }
    return result;
  }, {} as ActionResult);

  return <>
    <form action={sendCode} className="sys-form" aria-busy={sending}>
      <p className="sys-form-hint">First, send a verification code to your account email. Enter it below to confirm the change.</p>
      <button className="sys-button sys-button-secondary" disabled={sending || updating} type="submit">{sending ? "Sending code…" : codeSent ? "Resend verification code" : "Send verification code"}</button>
      <div aria-live="polite">{requestState.error && <p className="sys-notice sys-notice-error" role="alert">{requestState.error}</p>}{requestState.success && !completed && <p className="sys-notice sys-notice-success" role="status">{requestState.success}</p>}</div>
    </form>
    <ActionForm action={async (previous, data) => {
      setUpdating(true);
      try {
        const result = await updatePassword(previous, data);
        if (result.success) { setCompleted(true); setCodeSent(false); }
        return result;
      } finally { setUpdating(false); }
    }} submitLabel="Verify code and change password" pendingLabel="Verifying and updating…" disabled={!codeSent || sending}>
      <label className="sys-field"><span>Email verification code</span><input className="sys-input" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required/></label>
      <label className="sys-field"><span>New password</span><input className="sys-input" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
      <label className="sys-field"><span>Confirm new password</span><input className="sys-input" name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label>
      <p className="sys-form-hint">Use at least 12 characters. Request a new code after an expired or used code.</p>
    </ActionForm>
  </>;
}
