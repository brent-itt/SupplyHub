"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { generateStudentFormQR } from "@/app/student-stock-out-actions";
import { PrintButton } from "@/components/system/print-button";

export function StudentFormQR({ initialURL, initialImage }: { initialURL: string; initialImage: string }) {
  const [site, setSite] = useState(initialURL);
  const [qr, setQR] = useState({ url: initialURL, image: initialImage });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const localOnly = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(qr.url).hostname);
  return <div className="student-qr-layout">
    <section className="sys-card sys-no-print">
      <h2>Share the student form</h2>
      <form className="sys-form" onSubmit={event => {
        event.preventDefault(); setError("");
        startTransition(async () => {
          try {
            const result = await generateStudentFormQR(site);
            if (result.error || !result.url || !result.image) setError(result.error || "Unable to generate the QR code.");
            else setQR({ url: result.url, image: result.image });
          } catch { setError("Unable to generate the QR code. Please try again."); }
        });
      }}>
        <label className="sys-field"><span>SupplyHub website address</span><input className="sys-input" type="url" value={site} onChange={event => setSite(event.target.value)} required maxLength={2048}/><small>Use your published website address. For local phone testing, use this computer&apos;s network address and connect the phone to the same Wi-Fi. The QR code always opens /form.</small></label>
        <button className="sys-button" disabled={pending}>{pending ? "Generating…" : "Update QR code"}</button>
      </form>
      {error && <p className="sys-error" role="alert">{error}</p>}
      {localOnly && <p className="sys-notice sys-notice-error">This QR code currently uses localhost. Enter an address reachable from students&apos; phones before printing.</p>}
      <div className="sys-actions student-qr-actions"><PrintButton label="Print QR poster"/><a className="sys-button sys-button-secondary" href={qr.image} download="supplyhub-student-form-qr.svg">Download QR</a><a className="sys-link" href={qr.url} target="_blank" rel="noreferrer">Open form</a></div>
    </section>
    <section className="sys-card student-qr-poster">
      <p className="sys-eyebrow">PANPACIFIC UNIVERSITY · SUPPLYHUB</p>
      <h2>Collecting supplies?</h2>
      <p>Scan to fill out the student stock-out form.</p>
      <Image src={qr.image} width={280} height={280} unoptimized alt={`QR code for the student form at ${qr.url}`}/>
      <strong>Name · Date · Receipt number · Item</strong>
      <p>Submit your information, then show your receipt to the Supplies Office. Staff will confirm and issue your item.</p>
      <a className="sys-link" href={qr.url}>{qr.url}</a>
      <p className="sys-muted">No sign-in needed.</p>
    </section>
  </div>;
}
