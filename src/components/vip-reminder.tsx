"use client";

import { useActionState, useRef } from "react";
import { sendVipReminder } from "@/app/vip-reminder-actions";
import type { ActionResult } from "@/lib/types";
import type { VipQueueEntry } from "@/lib/student-stock-out";
import { vipReminderMessage } from "@/lib/vip-reminder";

export function VipReminder({ entry }: { entry: VipQueueEntry }) {
  const requestId = useRef<string | null>(null);
  const [state, action, pending] = useActionState<ActionResult, FormData>(async (previous, data) => {
    requestId.current ??= crypto.randomUUID();
    data.set("request_id", requestId.current);
    return sendVipReminder(previous, data);
  }, {});
  const preview = vipReminderMessage(entry);
  return <details className="vip-reminder sys-no-print">
    <summary className="sys-link">Send reminder</summary>
    <form className="sys-form vip-reminder-form" action={action} aria-busy={pending} onReset={event => event.preventDefault()}>
      <input type="hidden" name="id" value={entry.id}/>
      <label className="sys-field"><span>Student email</span><input className="sys-input" type="email" name="email" defaultValue={entry.student_email ?? ""} readOnly={!!entry.student_email || !!state.success} required maxLength={254} placeholder="student@example.com" disabled={pending}/></label>
      {!entry.student_email && <p className="sys-form-hint">This submission has no email. Enter the student&apos;s email; it will be saved when the reminder is prepared.</p>}
      <div className="vip-reminder-preview"><strong>{preview.subject}</strong><p>{preview.text}</p></div>
      <p className="sys-form-hint">The email uses the latest queue status when sent. Sending a reminder does not change stock or queue priority.</p>
      {state.error && <p className="sys-error" role="alert">{state.error}</p>}
      {state.success && <p className="sys-notice sys-notice-success" role="status">{state.success}</p>}
      <button type="submit" className="sys-button sys-button-small" disabled={pending || !!state.success}>{pending ? "Sending reminder…" : state.success ? "Reminder sent" : state.error ? "Retry reminder" : "Send email reminder"}</button>
    </form>
  </details>;
}
