import { requisitionDateSchema, universityDate } from "./requisitions";

/** Reports and CSV exports use the university's calendar day, including midnight. */
export function reportDateRange(fromValue: unknown, toValue: unknown, now = new Date()) {
  const today = universityDate(now);
  const firstDay = new Date(`${today}T12:00:00+08:00`);
  firstDay.setUTCDate(firstDay.getUTCDate() - 29);
  function date(value: unknown, fallback: string) {
    if (value === undefined || value === null || value === "") return fallback;
    const parsed = requisitionDateSchema.safeParse(value);
    if (!parsed.success) throw new RangeError("Choose valid report dates.");
    return parsed.data;
  }
  const from = date(fromValue, universityDate(firstDay));
  const to = date(toValue, today);
  if (from > to) throw new RangeError("The report's From date must be on or before its To date.");
  return {
    from, to,
    start: new Date(`${from}T00:00:00.000+08:00`).toISOString(),
    end: new Date(`${to}T23:59:59.999+08:00`).toISOString(),
  };
}
