"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { checkoutStockAction } from "@/app/stock-out-actions";
import { BarcodeScanner } from "@/components/barcode-scanner";
import { Icon } from "@/components/system/icons";
import { normalizeBarcode } from "@/lib/barcode";
import { checkoutSchema, type Checkout, type CheckoutResult } from "@/lib/stock-out";
import { formatRequestDate, universityDate } from "@/lib/requisitions";
import type { Item } from "@/lib/types";
import type { StudentCheckoutLog } from "@/lib/student-stock-out";

type CartLine = { item: Item; quantity: number };

export function StockOutPOS({ items, defaultDate, studentLog }: { items: Item[]; defaultDate: string; studentLog?: StudentCheckoutLog }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const cartRef = useRef(cart);
  const [note, setNote] = useState(studentLog ? "Student collection" : "");
  const [recipientName, setRecipientName] = useState(studentLog?.student_name ?? "");
  const [receiptNumber, setReceiptNumber] = useState(studentLog?.receipt_number ?? "");
  const [receiptDate, setReceiptDate] = useState(studentLog?.receipt_date ?? defaultDate);
  const [scannedBarcode, setScannedBarcode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [attempt, setAttempt] = useState<Checkout | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const closed = !!studentLog && studentLog.status !== "pending" && !attempt;
  const locked = review || !!attempt || pending || closed;
  const complete = !!attempt && result?.completed.length === attempt.lines.length && !result.error;
  const categories = [...new Set(items.map(item => item.category))].sort();
  const filtered = items.filter(item => (!category || item.category === category) &&
    `${item.name} ${item.sku}`.toLowerCase().includes(search.trim().toLowerCase()));
  const total = cart.reduce((sum, line) => sum + line.quantity, 0);

  function updateCart(lines: CartLine[]) {
    if (!lines.length) setScannedBarcode("");
    cartRef.current = lines;
    setCart(lines);
  }

  function addItem(item: Item) {
    if (locked || studentLog) return;
    const existing = cartRef.current.find(line => line.item.id === item.id);
    if ((existing?.quantity ?? 0) >= item.quantity) {
      setError(`${item.name}: only ${item.quantity} ${item.unit} available.`);
      setMessage("");
      return;
    }
    if (!existing && cartRef.current.length >= 100) {
      setError("A checkout can contain up to 100 different items.");
      return;
    }
    updateCart(existing
      ? cartRef.current.map(line => line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line)
      : [...cartRef.current, { item, quantity: 1 }]);
    setError("");
    setMessage(`${item.name} added · ${existing ? existing.quantity + 1 : 1} in cart`);
  }

  function scan(value: string) {
    if (locked) return;
    const code = normalizeBarcode(value);
    const item = code ? items.find(item => item.sku.toUpperCase() === code) : undefined;
    if (!item) {
      setError("Barcode not found. Use the item's stock code or find it in the catalog below.");
      setMessage("");
      return;
    }
    if (studentLog) {
      if (item.id !== studentLog.item_id) {
        setError(`Wrong item. Scan the barcode for ${studentLog.item_name}.`);
        return;
      }
      if (item.quantity < studentLog.quantity) {
        setError(`${item.name}: ${studentLog.quantity} ${item.unit} requested, but only ${item.quantity} available.`);
        return;
      }
      updateCart([{ item, quantity: studentLog.quantity }]);
      setScannedBarcode(code!);
      setError("");
      setMessage(`Barcode verified. ${studentLog.quantity} ${item.unit} ready for stock out.`);
    } else addItem(item);
  }

  function changeQuantity(id: string, quantity: number) {
    if (locked || studentLog) return;
    const item = items.find(item => item.id === id);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
      setError(`Enter a whole quantity between 1 and ${item?.quantity ?? 0}.`);
      return;
    }
    updateCart(cartRef.current.map(line => line.item.id === id ? { ...line, quantity } : line));
    setError("");
  }

  function reset() {
    if (studentLog) { router.push("/student-logs"); return; }
    updateCart([]);
    setAttempt(null);
    setResult(null);
    setReview(false);
    setNote("");
    setRecipientName("");
    setReceiptNumber("");
    setReceiptDate(universityDate());
    setMessage("");
    setError("");
    router.refresh();
  }

  function checkout() {
    if (busy.current || !cart.length || closed) return;
    if (studentLog && !scannedBarcode) { setError("Scan the requested item's barcode before completing stock out."); return; }
    const payload: Checkout = attempt ?? {
      reference: crypto.randomUUID(), note: note.trim(),
      recipient_name: recipientName.trim(), receipt_number: receiptNumber.trim(), receipt_date: receiptDate,
      ...(studentLog ? { student_log_id: studentLog.id, scanned_barcode: scannedBarcode } : {}),
      lines: cart.map(line => ({ item_id: line.item.id, quantity: line.quantity, idempotency_key: crypto.randomUUID() })),
    };
    const parsed = checkoutSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      setReview(false);
      return;
    }
    busy.current = true;
    setAttempt(payload);
    setReview(false);
    setError("");
    startTransition(async () => {
      try {
        const response = await checkoutStockAction(payload);
        // A retry can fail before reaching a line already confirmed earlier.
        setResult(previous => ({ ...response, canEdit: response.canEdit && (!previous || previous.canEdit), completed: [...new Set([...(previous?.completed ?? []), ...response.completed])] }));
        router.refresh();
      } catch {
        setResult(previous => ({ completed: previous?.completed ?? [], error: "Connection interrupted. Retry this checkout to confirm the stock out safely.", canEdit: false }));
      } finally {
        busy.current = false;
      }
    });
  }

  return <div className="pos-layout">
    <div className="pos-catalog-column sys-no-print">
      {studentLog && <div className="sys-card"><p className="sys-eyebrow">STUDENT COLLECTION</p><h2>{studentLog.item_name}</h2><p>{studentLog.quantity} {studentLog.unit} for {studentLog.student_name}</p><p className="sys-form-hint">{closed ? `This submission is already ${studentLog.status}. Open another entry from the student log.` : "Scan this item's barcode to add the requested quantity. The student details below are filled in from the submission."}</p></div>}
      {!locked && <BarcodeScanner onScan={scan} disabled={pending}/>}
      {locked && !closed && <div className="pos-scanner pos-review-banner"><Icon name={complete ? "check" : "lock"} size={24}/><div><h2>{complete ? "Stock updated" : "Checkout in progress"}</h2><p>{complete ? "Your stock out has been recorded." : "Review the cart on the right. Scanning is paused during checkout."}</p></div></div>}
      <div aria-live="polite">{message && !error && !locked && <p className="pos-feedback"><Icon name="check" size={16}/>{message}</p>}</div>
      {error && <p role="alert" className="sys-error">{error}</p>}
      <section className="pos-catalog" aria-labelledby="catalog-heading">
        <div className="pos-section-heading"><div><h2 id="catalog-heading">Supply catalog</h2><p>{studentLog ? "Scan the requested barcode to add it to the cart" : "Select an item to add it to your cart"}</p></div><span>{items.length} items</span></div>
        <label className="sys-search pos-search"><Icon name="search" size={18}/><span className="sys-sr-only">Search supplies</span><input className="sys-input" placeholder="Search by name or barcode…" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <div className="pos-categories" aria-label="Filter by category"><button type="button" aria-pressed={!category} onClick={() => setCategory("")}>All supplies</button>{categories.map(name => <button type="button" key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div>
        <div className="pos-products">
          {filtered.slice(0, 60).map(item => {
            const selected = cart.find(line => line.item.id === item.id)?.quantity ?? 0;
            return <button type="button" className={`pos-product${selected ? " pos-product-selected" : ""}`} key={item.id} disabled={!!studentLog || locked || item.quantity === 0 || selected >= item.quantity} onClick={() => addItem(item)} aria-label={`Add ${item.name} to cart`}>
              <div className="pos-product-top"><span className="pos-product-icon"><Icon name="inventory" size={25}/></span><span className={`sys-badge sys-badge-${item.quantity === 0 ? "red" : item.quantity <= item.low_stock_threshold ? "amber" : "green"}`}>{item.quantity === 0 ? "Out of stock" : item.quantity <= item.low_stock_threshold ? "Low stock" : "Available"}</span></div>
              <span className="pos-product-category">{item.category}</span><strong>{item.name}</strong><span className="pos-product-code">{item.sku}</span>
              <span className="pos-product-bottom"><span><b>{item.quantity.toLocaleString()}</b> {item.unit} in stock</span><span className="pos-product-add">{selected ? selected : <Icon name="plus" size={17}/>}</span></span>
            </button>;
          })}
        </div>
        {!filtered.length && <div className="sys-empty-state"><Icon name="search" size={28}/><h2>No supplies found</h2><p>{items.length ? "Try another name, barcode, or category." : "Add supplies and receive stock in Inventory to get started."}</p></div>}
        {filtered.length > 60 && <p className="sys-form-hint">Showing the first 60 matches. Narrow your search to find more supplies.</p>}
      </section>
    </div>
    <aside className="pos-cart" aria-labelledby="cart-heading">
      <div className="pos-cart-header"><div><p className="sys-eyebrow">STOCK OUT</p><h2 id="cart-heading">{complete ? "Stock-out receipt" : "Current cart"}</h2></div><span className="pos-cart-count">{cart.length}</span></div>
      {!cart.length ? <div className="pos-empty-cart"><span><Icon name="inventory" size={34}/></span><h3>{studentLog ? "Waiting for barcode scan" : "Your cart is empty"}</h3><p>{studentLog ? "Scan the requested item to continue." : "Scan a barcode or select a supply to start a stock out."}</p></div> : <div className="pos-cart-lines">{cart.map(line => {
        const issued = result?.completed.includes(line.item.id);
        return <div className={`pos-cart-line${issued ? " pos-line-issued" : ""}`} key={line.item.id}>
          <div className="pos-line-title"><strong>{line.item.name}</strong>{!locked && <button type="button" onClick={() => updateCart(cart.filter(row => row.item.id !== line.item.id))} aria-label={`Remove ${line.item.name}`}>×</button>}</div>
          <p>{line.item.sku} <span>· {line.item.unit}</span></p>
          <div className="pos-line-bottom">{locked || studentLog ? <strong>{line.quantity} {line.item.unit}</strong> : <div className="pos-quantity"><button type="button" aria-label={`Decrease ${line.item.name}`} disabled={line.quantity <= 1} onClick={() => changeQuantity(line.item.id, line.quantity - 1)}>−</button><input aria-label={`Quantity for ${line.item.name}`} type="number" min={1} max={items.find(item => item.id === line.item.id)?.quantity ?? line.item.quantity} value={line.quantity} onChange={event => changeQuantity(line.item.id, Number(event.target.value))}/><button type="button" aria-label={`Increase ${line.item.name}`} disabled={line.quantity >= (items.find(item => item.id === line.item.id)?.quantity ?? line.item.quantity)} onClick={() => changeQuantity(line.item.id, line.quantity + 1)}>+</button></div>}
            {issued ? <span className="pos-issued"><Icon name="check" size={14}/> Issued</span> : <span className="sys-muted">{locked ? "To issue" : `${items.find(item => item.id === line.item.id)?.quantity ?? 0} available`}</span>}
          </div>
        </div>;
      })}</div>}
      <div className="pos-cart-footer">
        <div className="pos-totals"><span>Supply lines <strong>{cart.length}</strong></span><span>Total units <strong>{total.toLocaleString()}</strong></span></div>
        {attempt && <p className="pos-reference">Reference: {studentLog ? `STUDENT-${studentLog.id}` : `POS-${attempt.reference}`}</p>}
        <form onSubmit={event => { event.preventDefault(); if (closed || !cart.length) return; if (studentLog && !scannedBarcode) { setError("Scan the requested item's barcode first."); return; } setError(""); setReview(true); }}>
          {attempt ? <dl className="pos-receipt-details">
            <div><dt>Name</dt><dd>{attempt.recipient_name}</dd></div>
            <div><dt>Receipt number</dt><dd>{attempt.receipt_number}</dd></div>
            <div><dt>Date</dt><dd>{formatRequestDate(attempt.receipt_date)}</dd></div>
            <div><dt>Purpose</dt><dd>{attempt.note}</dd></div>
          </dl> : <>
            <label className="sys-field"><span>Name of recipient</span><input className="sys-input" name="recipient_name" autoComplete="name" required minLength={2} maxLength={160} placeholder="Enter the recipient's full name" value={recipientName} readOnly={!!studentLog} disabled={locked} onChange={event => setRecipientName(event.target.value)}/></label>
            <label className="sys-field"><span>Receipt number</span><input className="sys-input" name="receipt_number" required maxLength={160} placeholder="e.g. SO-2026-0001" value={receiptNumber} readOnly={!!studentLog} disabled={locked} onChange={event => setReceiptNumber(event.target.value)}/></label>
            <label className="sys-field"><span>Date</span><input className="sys-input" name="receipt_date" type="date" required min="0001-01-01" max="9999-12-31" value={receiptDate} readOnly={!!studentLog} disabled={locked} onChange={event => setReceiptDate(event.target.value)}/></label>
            <label className="sys-field"><span>Purpose</span><textarea className="sys-input" rows={2} required minLength={3} maxLength={studentLog ? 500 : 1500} placeholder="e.g. Registrar's Office — daily supplies" value={note} disabled={locked} onChange={event => setNote(event.target.value)}/></label>
          </>}
          {review && <div className="pos-confirm" role="status"><strong>Confirm stock out</strong><p>Issue {total} units across {cart.length} supply lines? Available stock will be reduced immediately. Each line is recorded separately.</p><div className="sys-actions"><button type="button" className="sys-button" onClick={checkout}>Confirm & issue stock</button><button type="button" className="sys-button sys-button-secondary" onClick={() => setReview(false)}>Back</button></div></div>}
          {result?.error && <div className="sys-error pos-checkout-error" role="alert"><strong>{result.completed.length} of {cart.length} supply lines issued</strong><p>{result.error}</p><p>Confirmed lines stay recorded. Retrying will not issue them twice.</p></div>}
          {complete && <div className="sys-notice sys-notice-success" role="status"><Icon name="check"/><span>Stock out complete. Inventory, reports, and any linked student log are updated.</span></div>}
          <div className="pos-checkout-actions sys-no-print">
            {!locked && <><button className="sys-button pos-checkout-button" type="submit" disabled={!cart.length || (!!studentLog && !scannedBarcode)}><Icon name="arrow" size={18}/> Review stock out <span>{total} units</span></button><button type="button" className="pos-clear" disabled={!cart.length} onClick={() => { updateCart([]); setMessage(""); setError(""); }}>Clear cart</button></>}
            {attempt && !complete && <button type="button" className="sys-button pos-checkout-button" onClick={checkout} disabled={pending}>{pending ? "Updating stock…" : "Retry stock out"}</button>}
            {result?.error && result.canEdit && !pending && <button type="button" className="sys-button sys-button-secondary" onClick={() => { updateCart(cart.filter(line => !result.completed.includes(line.item.id))); setAttempt(null); setResult(null); setMessage("Confirmed items were issued. Review the remaining items before starting another checkout."); }}>Edit remaining items</button>}
            {complete && <><button type="button" className="sys-button pos-checkout-button" onClick={reset}><Icon name="plus" size={18}/>{studentLog ? "Back to student logs" : "New stock out"}</button><button type="button" className="sys-button sys-button-secondary" onClick={() => window.print()}><Icon name="print" size={17}/> Print receipt</button></>}
          </div>
        </form>
        {!attempt && !review && <p className="pos-cart-hint"><Icon name="lock" size={13}/> Stock changes only after confirmation</p>}
      </div>
    </aside>
  </div>;
}
