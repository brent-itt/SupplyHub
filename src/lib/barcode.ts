/** A printable stock code for supplies without an existing product barcode. */
export function defaultBarcode() {
  return `SUP-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

/** The stock code is also the barcode value. Preserve leading zeroes. */
export function normalizeBarcode(value: string): string | null {
  const code = value.trim();
  return /^[a-zA-Z0-9._-]{1,80}$/.test(code) ? code.toUpperCase() : null;
}
