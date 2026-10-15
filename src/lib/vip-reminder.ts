import type { VipQueueEntry } from "./student-stock-out";

export type ReminderEmail = { from: string; to: string[]; subject: string; text: string; reply_to?: string };
export type PreparedReminder = { id: string; recipient: string; payload: ReminderEmail; accepted_at: string | null };

export function vipReminderMessage(entry: VipQueueEntry) {
  const availability = entry.is_archived
    ? "Your requested item is currently unavailable. Please contact the Supplies Office about your remaining request."
    : entry.available_quantity > 0
      ? `${entry.available_quantity} ${entry.unit} are currently available for your collection. Please visit the Supplies Office and bring your receipt. Any uncollected balance will remain in VIP Queue.`
      : "Your request is still in VIP Queue while we wait for stock to become available for you. There is no stock ready for your collection yet. Earlier submissions for the same item are prioritized.";
  return {
    subject: entry.available_quantity > 0 && !entry.is_archived ? "SupplyHub: your supplies are ready for collection" : "SupplyHub: update on your VIP request",
    text: [
      `Hello ${entry.student_name},`, "", availability, "",
      `Item: ${entry.item_name} (${entry.item_code})`,
      `Receipt number: ${entry.receipt_number}`,
      `Requested: ${entry.quantity} ${entry.unit}`,
      `Already issued: ${entry.fulfilled_quantity} ${entry.unit}`,
      `Remaining: ${entry.remaining_quantity} ${entry.unit}`,
      `Queue position for this item: ${entry.item_position}`, "",
      "Availability is based on the latest check and may change before collection. Staff will confirm your remaining quantity at the counter.", "",
      "Supplies Office", "Panpacific University",
    ].join("\n"),
  };
}

/** The saved payload and key stay identical when retrying an uncertain send. */
export async function deliverVipReminder(reminder: PreparedReminder, apiKey: string, send: typeof fetch = fetch): Promise<string> {
  const response = await send("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `vip-reminder/${reminder.id}` },
    body: JSON.stringify(reminder.payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const details: unknown = await response.json().catch(() => null);
    const providerError = details && typeof details === "object" ? details as { name?: unknown; message?: unknown } : {};
    const message = typeof providerError.message === "string" ? providerError.message.toLowerCase() : "";
    if (response.status === 403 && message.includes("only send testing emails")) {
      throw new Error("Resend is limited to test recipients. Verify your sending domain in Resend, then use an address on that domain as RESEND_FROM_EMAIL to contact students.");
    }
    if (response.status === 403 && message.includes("domain") && message.includes("not verified")) {
      throw new Error("The sender domain is not verified in Resend. Open Resend → Domains, correct the required DNS records, and wait for Verified before retrying this reminder.");
    }
    if (providerError.name === "suspended_api_key") throw new Error("Resend has suspended this API key. Check the Resend account or contact their support before retrying.");
    if (providerError.name === "restricted_api_key" && response.status === 403) throw new Error("The Resend API key is inactive or restricted. Check its sending permission and allowed domain in Resend.");
    if (response.status === 401 || providerError.name === "invalid_api_key" || message.includes("api key is invalid")) throw new Error("Resend did not accept the API key. Check RESEND_API_KEY on the server and restart SupplyHub after updating it.");
    if (response.status === 403) throw new Error("Resend rejected this reminder. Check Resend Logs for the failed email request, including sender-domain verification and API-key permissions.");
    if (response.status === 429) throw new Error("The email service is busy. Please wait a moment and retry this reminder.");
    throw new Error("The email service did not confirm this reminder. Retry to check it safely.");
  }
  const data = await response.json();
  if (typeof data?.id !== "string" || !data.id) throw new Error("The email service did not return a confirmation. Retry this reminder.");
  return data.id;
}
