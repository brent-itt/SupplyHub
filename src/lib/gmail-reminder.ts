import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import type { PreparedReminder } from "./vip-reminder";

export class GmailDeliveryError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); }
}

export function gmailTransport(user: string, pass: string) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true,
    auth: { user, pass: pass.replace(/\s/g, "") },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

type Send = (mail: SendMailOptions) => Promise<{ messageId: string; accepted: unknown[] }>;

export async function deliverGmailReminder(reminder: PreparedReminder, send: Send): Promise<string> {
  try {
    const { reply_to, ...payload } = reminder.payload;
    const result = await send({ ...payload, replyTo: reply_to, messageId: `<vip-reminder.${reminder.id}@supplyhub.local>` });
    if (!result.accepted.length) throw new GmailDeliveryError("Gmail rejected the recipient. Check the student's email before retrying.", true);
    if (!result.messageId) throw new GmailDeliveryError("Gmail delivery is unconfirmed. Ask the administrator to check Gmail Sent before another attempt.", false);
    return result.messageId;
  } catch (error) {
    if (error instanceof GmailDeliveryError) throw error;
    const failure = error as { code?: string; responseCode?: number } | null;
    if (failure?.code === "EAUTH") throw new GmailDeliveryError("Gmail sign-in failed. Check GMAIL_USER and GMAIL_APP_PASSWORD, enable 2-Step Verification, and use a Google App Password.", true);
    if (failure?.responseCode && failure.responseCode >= 400 && failure.responseCode <= 599) {
      throw new GmailDeliveryError("Gmail rejected the reminder. Check the recipient, account sending limits, and Gmail settings before retrying.", true);
    }
    // A timeout can occur after Gmail accepted DATA. Never automatically resend it.
    throw new GmailDeliveryError("Gmail delivery is unconfirmed. Ask the administrator to check Gmail Sent before another attempt.", false);
  }
}
