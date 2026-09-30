"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { roleLabels, type ActionResult, type FormAction, type Item, type MovementKind, type Profile, type Role } from "@/lib/types";
import { ActionForm } from "./action-form";

function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return <label className={`sys-field${wide ? " sys-field-wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Roles({ defaultValue = "staff", disabled = false }: { defaultValue?: Role; disabled?: boolean }) {
  return <select name="role" className="sys-select" defaultValue={defaultValue} required disabled={disabled}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>;
}

export function ItemForm({ action, item }: { action: FormAction; item?: Item }) {
  return <ActionForm action={action} submitLabel={item ? "Save item details" : "Create supply item"}>
    {item && <input type="hidden" name="item_id" value={item.id}/>}
    <div className="sys-form-grid">
      <Field label="Supply name" wide><input className="sys-input" name="name" required maxLength={160} defaultValue={item?.name} placeholder="e.g. Scantron answer sheets"/></Field>
      <Field label="Item code (SKU)" hint="Use a unique code for this supply."><input className="sys-input" name="sku" required maxLength={80} defaultValue={item?.sku} placeholder="e.g. SCAN-001"/></Field>
      <Field label="Category"><input className="sys-input" name="category" required maxLength={80} defaultValue={item?.category || "General supplies"} list="supply-categories"/><datalist id="supply-categories"><option value="General supplies"/><option value="Office supplies"/><option value="Paper products"/><option value="Scantron"/><option value="Cleaning supplies"/><option value="Equipment"/></datalist></Field>
      <Field label="Unit" hint="The unit used for counting stock."><input className="sys-input" name="unit" required maxLength={40} defaultValue={item?.unit || "piece"} placeholder="piece, box, ream"/></Field>
      <Field label="Storage location"><input className="sys-input" name="location" maxLength={160} defaultValue={item?.location} placeholder="e.g. Supplies office, shelf A"/></Field>
      <Field label="Low-stock alert level" hint="An alert appears when stock reaches this quantity."><input className="sys-input" name="low_stock_threshold" type="number" required min={0} max={1000000000} step={1} defaultValue={item?.low_stock_threshold ?? 10}/></Field>
      <Field label="Description" wide><textarea className="sys-input" name="description" rows={3} maxLength={2000} defaultValue={item?.description} placeholder="Specifications or notes about this supply"/></Field>
    </div>
    {!item && <p className="sys-form-hint">New items start with zero stock. Record a stock-in transaction after creating the item.</p>}
  </ActionForm>;
}

export function MovementForm({ action, item, initialKind = "stock_in" }: { action: FormAction; item: Item; initialKind?: MovementKind }) {
  const [kind, setKind] = useState<MovementKind>(initialKind);
  const attemptKey = useRef<string | null>(null);
  const quantityHint = useId();

  async function recordMovement(previous: ActionResult, data: FormData) {
    // Retain the same key after errors so an uncertain response can be retried safely.
    attemptKey.current ??= crypto.randomUUID();
    data.set("idempotency_key", attemptKey.current);
    const result = await action(previous, data);
    if (result.success) attemptKey.current = null;
    return result;
  }

  return <ActionForm action={recordMovement} submitLabel="Record transaction" pendingLabel="Recording…" disabled={item.is_archived}>
    <input type="hidden" name="item_id" value={item.id}/>
    <input type="hidden" name="idempotency_key" defaultValue=""/>
    <div className="sys-form-grid">
      <Field label="Transaction type" wide><select className="sys-select" name="kind" value={kind} onChange={(event) => setKind(event.target.value as MovementKind)}><option value="stock_in">Stock in — receive supplies</option><option value="stock_out">Stock out — issue supplies</option><option value="adjustment">Adjustment — set counted stock</option></select></Field>
      <Field label={kind === "adjustment" ? `Actual quantity on hand (${item.unit})` : `Quantity (${item.unit})`} wide><input className="sys-input" name="quantity" type="number" required min={kind === "adjustment" ? 0 : 1} max={1000000000} step={1} aria-describedby={quantityHint}/><small id={quantityHint}>{kind === "adjustment" ? `Enter the total counted stock, not the difference. Currently ${item.quantity} ${item.unit}.` : `Currently ${item.quantity} ${item.unit} available.`}</small></Field>
      <Field label="Reference" hint="Optional delivery, department, or document reference." wide><input className="sys-input" name="reference" maxLength={160} placeholder="e.g. Delivery receipt #1042"/></Field>
      <Field label={kind === "adjustment" ? "Reason for adjustment" : "Transaction note"} wide><textarea className="sys-input" name="note" rows={3} maxLength={2000} required={kind === "adjustment"} placeholder={kind === "adjustment" ? "Explain why the stock count needs to change" : "Delivery details or the recipient of these supplies"}/></Field>
    </div>
  </ActionForm>;
}

export function RequestForm({ action, items, itemId }: { action: FormAction; items: Item[]; itemId?: string }) {
  const availableItems = items.filter((item) => !item.is_archived);
  return <ActionForm action={action} submitLabel="Submit requisition" pendingLabel="Submitting…" disabled={!availableItems.length}>
    <Field label="Supply item"><select className="sys-select" name="item_id" required defaultValue={itemId || ""}><option value="" disabled>Select a supply item</option>{availableItems.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.sku} ({item.quantity} {item.unit} available)</option>)}</select></Field>
    <Field label="Quantity requested"><input className="sys-input" type="number" name="quantity" required min={1} max={1000000000} step={1}/></Field>
    <Field label="Purpose" hint="Include the department, class, or activity needing these supplies."><textarea className="sys-input" name="purpose" required minLength={3} maxLength={2000} rows={4} placeholder="Describe what these supplies will be used for"/></Field>
    <p className="sys-form-hint">The Supplies Office will review your request. Stock is issued when your request is approved.</p>
    {!availableItems.length && <p className="sys-notice">No supply items are available for requests yet.</p>}
  </ActionForm>;
}

export function ReviewForm({ action, requestId }: { action: FormAction; requestId: string }) {
  const [decision, setDecision] = useState("approved");
  return <ActionForm action={action} submitLabel={decision === "approved" ? "Approve and issue stock" : "Reject requisition"} pendingLabel="Updating requisition…" confirmMessage={decision === "approved" ? "Approve this requisition and deduct the requested quantity from stock?" : "Reject this requisition?"}>
    <input type="hidden" name="request_id" value={requestId}/>
    <Field label="Decision"><select className="sys-select" name="decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="approved">Approve and issue stock</option><option value="rejected">Reject request</option></select></Field>
    <Field label="Review note"><textarea className="sys-input" name="review_note" maxLength={2000} rows={3} placeholder="Add instructions or explain the decision"/></Field>
  </ActionForm>;
}

export function CancelRequestForm({ action, requestId }: { action: FormAction; requestId: string }) {
  return <ActionForm action={action} submitLabel="Cancel requisition" pendingLabel="Cancelling…" className="sys-compact-form" confirmMessage="Cancel this requisition? It will no longer be sent for approval."><input type="hidden" name="request_id" value={requestId}/></ActionForm>;
}

export function UserAccessForm({ action, user, currentUserId }: { action: FormAction; user: Profile; currentUserId: string }) {
  if (user.id === currentUserId) return <p className="sys-form-hint">This is your account. Your own role and access cannot be changed here.</p>;
  return <ActionForm action={action} submitLabel="Save access" pendingLabel="Updating…" className="sys-access-form" confirmMessage={`Update access for ${user.full_name || user.email}?`}>
    <input type="hidden" name="user_id" value={user.id}/>
    <div className="sys-form-grid"><Field label="Role"><Roles defaultValue={user.role}/></Field><Field label="Account access"><select className="sys-select" name="is_active" defaultValue={String(user.is_active)}><option value="true">Active</option><option value="false">Deactivated</option></select></Field></div>
  </ActionForm>;
}

export function CreateAccountForm({ action }: { action: FormAction }) {
  return <ActionForm action={action} submitLabel="Create account" pendingLabel="Creating account…">
    <Field label="Full name"><input className="sys-input" name="full_name" required minLength={2} maxLength={160} autoComplete="name" placeholder="Enter the user's full name"/></Field>
    <Field label="Email address"><input className="sys-input" name="email" required type="email" maxLength={254} autoComplete="email" placeholder="name@university.edu.ph"/></Field>
    <Field label="Role"><Roles/></Field>
    <Field label="Temporary password" hint="Use at least 12 characters. Share it securely with the account owner."><input className="sys-input" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></Field>
    <p className="sys-form-hint">Create accounts only for verified university users. The account owner can change their password after signing in.</p>
  </ActionForm>;
}

export function PublicVisibilityForm({ action, item }: { action: FormAction; item: Item }) {
  return <ActionForm action={action} submitLabel={item.show_on_landing ? "Remove from public list" : "Show on public list"} pendingLabel="Saving…">
    <input type="hidden" name="item_id" value={item.id}/>
    <input type="hidden" name="show_on_landing" value={String(!item.show_on_landing)}/>
    <p className="sys-form-hint">{item.show_on_landing ? "This item appears on the public home page while it is active." : "Only selected items appear on the public home page."}</p>
  </ActionForm>;
}
