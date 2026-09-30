"use client";

import { Icon } from "./icons";

export function PrintButton({ label = "Print report" }: { label?: string }) {
  return <button type="button" className="sys-button sys-button-secondary sys-no-print" onClick={() => window.print()}><Icon name="print" size={17}/>{label}</button>;
}
