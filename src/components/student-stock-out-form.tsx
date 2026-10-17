"use client";

import { useActionState } from "react";
import { submitStudentStockOut } from "@/app/student-stock-out-actions";
import { formatRequestDate } from "@/lib/requisitions";
import type { StudentFormItem, StudentSubmissionResult } from "@/lib/student-stock-out";
import { StudentItemPicker } from "@/components/student-item-picker";

export function StudentStockOutForm({ items, defaultDate, submissionId, available }: { items: StudentFormItem[]; defaultDate: string; submissionId: string; available: boolean }) {
  const [state, action, pending] = useActionState<StudentSubmissionResult, FormData>(submitStudentStockOut, {});
  if (state.submission) {
    const log = state.submission;
    return <section className="student-form-success" aria-labelledby="submission-heading">
      <div className="sys-notice sys-notice-success" role="status"><p>Your information has been sent to the Supplies Office.</p></div>
      <h2 id="submission-heading">Your submission</h2>
      <dl className="pos-receipt-details">
        <div><dt>Name</dt><dd>{log.student_name}</dd></div>
        <div><dt>Email</dt><dd>{log.student_email}</dd></div>
        <div><dt>Date</dt><dd>{formatRequestDate(log.receipt_date)}</dd></div>
        <div><dt>Receipt number</dt><dd>{log.receipt_number}</dd></div>
        <div><dt>Item</dt><dd>{log.item_name} ({log.item_code})</dd></div>
        <div><dt>Quantity</dt><dd>{log.quantity} {log.unit}</dd></div>
        <div><dt>Status</dt><dd>{log.status === "pending" ? log.vip_queued_at ? "VIP Queue — priority for available and incoming stock" : "Pending staff confirmation" : log.status === "issued" ? "Issued" : "Rejected"}</dd></div>
        <div><dt>Submission reference</dt><dd>{log.id}</dd></div>
      </dl>
      <p className="sys-form-hint">Keep this confirmation and present your receipt to the Supplies Office. Supplies are issued only after staff checks your submission.</p>
      {log.status === "pending" && log.vip_queued_at && <p className="sys-form-hint">There is not enough unreserved stock for your full request. Staff can issue the available quantity and your remaining balance will stay in VIP Queue.</p>}
      <div className="sys-actions sys-no-print"><button className="sys-button" onClick={() => window.print()}>Print confirmation</button><a className="sys-button sys-button-secondary" href="/form">Submit another item</a></div>
    </section>;
  }
  return <form className="sys-form student-public-form" action={action} aria-busy={pending} onReset={event => event.preventDefault()}>
    <p className="sys-form-hint">All fields are required. Complete every field before sending your form.</p>
    <input type="hidden" name="submission_id" value={submissionId}/>
    <div className="student-form-trap" aria-hidden="true"><label>Leave this blank<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
    <fieldset className="sys-form-fields" disabled={pending || !available}>
      <label className="sys-field"><span>Full name</span><input className="sys-input" name="student_name" autoComplete="name" placeholder="Enter your full name" required minLength={2} maxLength={160} pattern={".*\\S.*"} title="Enter your full name. Spaces alone are not accepted."/></label>
      <label className="sys-field"><span>Email address</span><input className="sys-input" type="email" name="student_email" autoComplete="email" placeholder="you@example.com" required maxLength={254}/><small>The Supplies Office can use this email to contact you about your collection.</small></label>
      <div className="sys-form-grid">
        <label className="sys-field"><span>Date</span><input className="sys-input" type="date" name="receipt_date" required min="0001-01-01" max="9999-12-31" defaultValue={defaultDate}/></label>
        <label className="sys-field"><span>Receipt number</span><input className="sys-input" name="receipt_number" placeholder="Number on your receipt" required maxLength={160} pattern={".*\\S.*"} title="Enter your receipt number. Spaces alone are not accepted."/></label>
      </div>
      <StudentItemPicker items={items} disabled={pending || !available}/>
      <label className="sys-field"><span>Quantity</span><input className="sys-input" type="number" inputMode="numeric" name="quantity" min={1} max={2147483647} step={1} defaultValue={1} required/><small>Use the unit shown beside the selected item. Submit a separate form for each different item.</small></label>
    </fieldset>
    <p className="sys-form-hint">Your name, email, and receipt details are visible only to authorized Supplies Office staff and administrators. Please check them before submitting.</p>
    {state.error && <div className="sys-notice sys-notice-error" role="alert"><p>{state.error}</p></div>}
    <button className="sys-button" type="submit" disabled={pending || !available}>{pending ? "Sending your information…" : "Send to Supplies Office"}</button>
    <p className="sys-form-hint">No student account or sign-in is needed.</p>
  </form>;
}
