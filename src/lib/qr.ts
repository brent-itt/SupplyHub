const ITEM_CODE_PREFIX = "supalies:item:";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** QR payloads identify an item only; they never contain a destination URL. */
export function buildItemCode(id: string): string {
  const normalized = id.trim().toLowerCase();

  if (!UUID_PATTERN.test(normalized)) {
    throw new Error("A valid item UUID is required to generate a QR code.");
  }

  return `${ITEM_CODE_PREFIX}${normalized}`;
}

/** Accept our QR format or a pasted UUID, never arbitrary links or commands. */
export function parseItemCode(value: string): string | null {
  const normalized = value.trim();
  const id = normalized.startsWith(ITEM_CODE_PREFIX)
    ? normalized.slice(ITEM_CODE_PREFIX.length)
    : normalized;

  return UUID_PATTERN.test(id) ? id.toLowerCase() : null;
}
