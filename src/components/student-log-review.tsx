"use client";

import { useState } from "react";
import { processStudentStockOut } from "@/app/student-stock-out-actions";
import { ActionForm } from "@/components/system/action-form";

export function StudentLogReview({ id, quantity, unit }: { id: string; quantity: number; unit: string }) {
  const [decision, setDecision] = useState("issued");
  return <details className="student-log-review sys-no-print"><summary className="sys-link">Review submission</summary>
    <ActionForm action={processStudentStockOut} submitLabel={decision === "issued" ? "Confirm & scan barcode" : "Reject submission"}
      confirmMessage={decision === "issued" ? undefined : "Reject the remaining request? Any previously issued stock stays recorded."}>
      <input type="hidden" name="id" value={id}/>
      <label className="sys-field"><span>Decision</span><select className="sys-select" name="decision" value={decision} onChange={event => setDecision(event.target.value)}><option value="issued">Continue to barcode stock out</option><option value="rejected">Reject submission</option></select></label>
      {decision === "issued" ? <><input type="hidden" name="note" value=""/><p className="sys-form-hint">Next: scan the requested item for {quantity} {unit}. Student details will be filled in. Stock changes only after barcode checkout.</p></> : <label className="sys-field"><span>Reason for rejection</span><textarea className="sys-input" name="note" maxLength={500} required minLength={3} rows={2}/></label>}
    </ActionForm>
  </details>;
}
