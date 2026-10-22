"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { roleLabels, type AccountProfile, type ActionResult, type FormAction, type Item, type MovementKind, type Requisition, type RequisitionItem, type Role } from "@/lib/types";
import { ActionForm } from "./action-form";
import { matchingSupplyNames } from "@/lib/requisitions";
import { defaultBarcode } from "@/lib/barcode";

function Field({ label, children, hint, wide = false }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return <label className={`sys-field${wide ? " sys-field-wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Roles({ defaultValue = "staff", disabled = false }: { defaultValue?: Role; disabled?: boolean }) {
  return <select name="role" className="sys-select" defaultValue={defaultValue} required disabled={disabled}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select>;
}

export function ItemForm({ action, item, defaultCode }: { action: FormAction; item?: Item; defaultCode?: string }) {
  const [code, setCode] = useState(item?.sku ?? defaultCode ?? "");
  async function saveItem(previous: ActionResult, data: FormData) {
    const result = await action(previous, data);
    if (result.success && !item) setCode(defaultBarcode());
    return result;
  }
  return <ActionForm action={saveItem} submitLabel={item ? "Save item details" : "Create supply item"}>
    {item && <input type="hidden" name="item_id" value={item.id}/>}
    <div className="sys-form-grid">
      <Field label="Supply name" wide><input className="sys-input" name="name" required maxLength={160} defaultValue={item?.name} placeholder="e.g. Scantron answer sheets"/></Field>
      <Field label="Barcode / stock code (SKU)" hint={item ? "Printed labels use this code; reprint them if it changes." : "A default code is provided. Keep it, enter your own, or replace it with a scanned product barcode. Print its label after saving."}><input className="sys-input" name="sku" required maxLength={80} value={code} onChange={event => setCode(event.target.value)} placeholder="e.g. SUP-001 or 4801234567890"/></Field>
      <Field label="Category" hint="Enter any category name. Use the same name to group supplies under one QR code; different names get separate QR codes on the landing page."><input className="sys-input" name="category" required maxLength={80} defaultValue={item?.category ?? ""} placeholder="e.g. Lab materials or Sports supplies" autoComplete="off"/></Field>
      <Field label="Unit" hint="The unit used for counting stock."><input className="sys-input" name="unit" required maxLength={40} defaultValue={item?.unit || "piece"} placeholder="piece, box, ream"/></Field>
      <Field label="Storage location"><input className="sys-input" name="location" maxLength={160} defaultValue={item?.location} placeholder="e.g. Supplies office, shelf A"/></Field>
      <Field label="Low-stock alert level" hint="An alert appears when stock reaches this quantity."><input className="sys-input" name="low_stock_threshold" type="number" required min={0} max={1000000000} step={1} defaultValue={item?.low_stock_threshold ?? 10}/></Field>
      <Field label="Description" wide><textarea className="sys-input" name="description" rows={3} maxLength={2000} defaultValue={item?.description} placeholder="Specifications or notes about this supply"/></Field>
    </div>
    {!item && <p className="sys-form-hint">New items start with zero stock. Record a stock-in transaction after creating the item. To display its category QR code on the landing page, open the item, choose Show on public list under Public stock list, and save the displayed quantity.</p>}
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

export function RequestForm({ action, items, itemId, requesterName, defaultDate, request }: { action: FormAction; items: RequisitionItem[]; itemId?: string; requesterName: string; defaultDate: string; request?: Requisition }) {
  const availableItems = items.filter((item) => !item.is_archived);
  const initialItem = availableItems.find(item => item.id === (request?.item_id ?? itemId));
  const [itemName, setItemName] = useState(initialItem?.name ?? "");
  const [choiceId, setChoiceId] = useState(initialItem?.id ?? "");
  const namesId = useId();
  const matches = matchingSupplyNames(availableItems, itemName);
  const selectedItem = matches.length === 1 ? matches[0] : matches.find(item => item.id === choiceId);
  async function submitRequest(previous: ActionResult, data: FormData) {
    if (!selectedItem) return { error: "Choose an existing supply by name. If names match, select its item code." };
    const result = await action(previous, data);
    if (result.success && !request) { setItemName(""); setChoiceId(""); }
    return result;
  }
  return <ActionForm action={submitRequest} submitLabel={request ? "Save changes" : "Submit requisition"} pendingLabel={request ? "Saving changes…" : "Submitting…"} disabled={!availableItems.length}>
    {request && <><input type="hidden" name="request_id" value={request.id}/><input type="hidden" name="expected_version" value={request.version}/></>}
    <input type="hidden" name="item_id" value={selectedItem?.id ?? ""}/>
    <div className="sys-form-grid">
      <Field label="Name of requestor" hint="Name of the school staff member who needs these supplies."><input className="sys-input" name="requester_name" autoComplete="name" required minLength={2} maxLength={160} defaultValue={requesterName} placeholder="Enter the school staff member's full name"/></Field>
      <Field label="Date"><input className="sys-input" type="date" name="request_date" required defaultValue={defaultDate}/></Field>
      <Field label="Item name" hint="Type or choose an existing supply name." wide><input className="sys-input" name="item_name" list={namesId} required maxLength={160} value={itemName} onChange={event => { setItemName(event.target.value); setChoiceId(""); }} placeholder="Start typing an item name" autoComplete="off"/><datalist id={namesId}>{[...new Set(availableItems.map(item => item.name))].map(name => <option key={name} value={name}/>)}</datalist></Field>
      {matches.length > 1 && <Field label="Choose the matching supply" hint="These supplies share a name. Select the correct code." wide><select className="sys-select" required value={choiceId} onChange={event => setChoiceId(event.target.value)}><option value="">Choose an item code</option>{matches.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.unit} · {item.location || item.category}</option>)}</select></Field>}
      <Field label="Item code" hint="Filled automatically from the selected item name."><input className="sys-input" name="item_code" readOnly value={selectedItem?.sku ?? ""} placeholder="Select an item name first"/></Field>
      <Field label="Quantity requested"><input className="sys-input" type="number" name="quantity" required min={1} max={2147483647} step={1} defaultValue={request?.quantity}/></Field>
    </div>
    {itemName && !selectedItem && <p className="sys-form-hint" role="status">{matches.length > 1 ? "Choose the matching supply above to fill its code." : "Choose a matching name from the supply list to fill its code."}</p>}
    {selectedItem && <p className="sys-form-hint" role="status">{selectedItem.quantity} {selectedItem.unit} currently available.</p>}
    <Field label="Purpose" hint="Include the department, class, or activity needing these supplies."><textarea className="sys-input" name="purpose" required minLength={3} maxLength={2000} rows={4} defaultValue={request?.purpose} placeholder="Describe what these supplies will be used for"/></Field>
    {request && <p className="sys-form-hint">Only pending requests can be edited. Changes are recorded in the admin activity log.</p>}
    <p className="sys-form-hint">Requisitions are for school staff. The Supplies Office reviews them before issuing stock. For a direct stock out, use Barcode stock out; no requisition is needed.</p>
    {!availableItems.length && <p className="sys-notice">No supply items are available for requests yet.</p>}
  </ActionForm>;
}

export function ReviewForm({ action, requestId, version }: { action: FormAction; requestId: string; version: number }) {
  const [decision, setDecision] = useState("approved");
  return <ActionForm action={action} submitLabel={decision === "approved" ? "Approve and issue stock" : "Reject requisition"} pendingLabel="Updating requisition…" confirmMessage={decision === "approved" ? "Approve this requisition and deduct the requested quantity from stock?" : "Reject this requisition?"}>
    <input type="hidden" name="request_id" value={requestId}/>
    <input type="hidden" name="expected_version" value={version}/>
    <Field label="Decision"><select className="sys-select" name="decision" value={decision} onChange={(event) => setDecision(event.target.value)}><option value="approved">Approve and issue stock</option><option value="rejected">Reject request</option></select></Field>
    <Field label="Review note"><textarea className="sys-input" name="review_note" maxLength={2000} rows={3} placeholder="Add instructions or explain the decision"/></Field>
  </ActionForm>;
}

export function CancelRequestForm({ action, requestId }: { action: FormAction; requestId: string }) {
  return <ActionForm action={action} submitLabel="Cancel requisition" pendingLabel="Cancelling…" className="sys-compact-form" confirmMessage="Cancel this requisition? It will no longer be sent for approval."><input type="hidden" name="request_id" value={requestId}/></ActionForm>;
}

export function UserAccessForm({ action, user, currentUserId }: { action: FormAction; user: AccountProfile; currentUserId: string }) {
  if (user.id === currentUserId) return <p className="sys-form-hint">This is your account. Your own role and access cannot be changed here.</p>;
  return <ActionForm action={action} submitLabel="Save access" pendingLabel="Updating…" className="sys-access-form" confirmMessage={`Update access for ${user.full_name || user.email}?`}>
    <input type="hidden" name="user_id" value={user.id}/>
    <div className="sys-form-grid"><Field label="Role"><Roles defaultValue={user.role}/></Field><Field label="Account access"><select key={`${user.email_verified}-${user.is_active}`} className="sys-select" name="is_active" defaultValue={String(user.email_verified && user.is_active)}><option value="true" disabled={!user.email_verified}>Active</option><option value="false">{user.email_verified ? "Deactivated" : "Pending email verification"}</option></select></Field></div>
    {!user.email_verified && <p className="sys-form-hint">The owner must confirm the emailed link before this account can be activated.</p>}
  </ActionForm>;
}

export function CreateAccountForm({ action }: { action: FormAction }) {
  return <ActionForm action={action} submitLabel="Create account" pendingLabel="Creating account…">
    <Field label="Full name"><input className="sys-input" name="full_name" required minLength={2} maxLength={160} autoComplete="name" placeholder="Enter the user's full name"/></Field>
    <Field label="Email address" hint="Use an inbox the account owner can access. Verification is required."><input className="sys-input" name="email" required type="email" maxLength={254} autoComplete="email" placeholder="name@university.edu.ph"/></Field>
    <Field label="Role"><Roles/></Field>
    <Field label="Temporary password" hint="Use at least 12 characters. Share it securely with the account owner."><input className="sys-input" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></Field>
    <p className="sys-form-hint">We will email a verification link. The account stays pending until the owner confirms their email and you activate it in User access.</p>
  </ActionForm>;
}

export function RemoveAccountForm({ action, user, currentUserId }: { action: FormAction; user: AccountProfile; currentUserId: string }) {
  if (user.id === currentUserId) return null;
  return <ActionForm action={action} submitLabel="Remove account" pendingLabel="Removing…" className="sys-remove-account-form" danger
    confirmMessage={`Remove the account for ${user.full_name || user.email} (${user.email})? They will no longer be able to sign in. Existing inventory and activity records will be kept. This cannot be undone.`}>
    <input type="hidden" name="user_id" value={user.id}/>
  </ActionForm>;
}

export function PublicVisibilityForm({ action, item }: { action: FormAction; item: Item }) {
  return <ActionForm action={action} submitLabel="Save public display" pendingLabel="Saving…">
    <input type="hidden" name="item_id" value={item.id}/>
    <Field label="Public visibility"><select className="sys-select" name="show_on_landing" defaultValue={String(item.show_on_landing)}><option value="false">Hidden from public list</option><option value="true">Show on public list</option></select></Field>
    <p className="sys-form-hint">When shown publicly, this supply appears under <strong>{item.category}</strong> on the landing page. This category has its own QR code, shared by supplies with the same category name.</p>
    <Field label={`Displayed quantity (${item.unit})`} hint="Choose the maximum quantity visitors see. If actual stock falls below this amount, the lower stock count is shown. This does not change inventory."><input className="sys-input" name="public_quantity" type="number" required min={0} max={2147483647} step={1} defaultValue={item.public_quantity ?? 0}/></Field>
    <p className="sys-form-hint">Actual stock: {item.quantity} {item.unit}. Set the displayed quantity to 0 to show this item as out of stock.</p>
    {item.is_archived && <p className="sys-form-hint">Archived supplies remain hidden until restored.</p>}
  </ActionForm>;
}
