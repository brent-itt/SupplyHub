"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeMutation, UserFacingError } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { VipQueueEntry } from "@/lib/student-stock-out";
import type { ActionResult } from "@/lib/types";
import { deliverVipReminder, vipReminderMessage, type PreparedReminder } from "@/lib/vip-reminder";
import { deliverGmailReminder, GmailDeliveryError, gmailTransport } from "@/lib/gmail-reminder";

export async function sendVipReminder(_previous: ActionResult, data: FormData): Promise<ActionResult> {
  const parsed = z.object({ id: z.string().uuid(), request_id: z.string().uuid(), email: z.string().trim().email().max(254).toLowerCase() }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { error: "Select a valid request and enter the student's email address." };
  try {
    const { supabase, user } = await authorizeMutation(["admin", "super_admin"]);
    const provider = process.env.EMAIL_PROVIDER?.trim() || "resend";
    if (provider !== "gmail" && provider !== "resend") return { error: "Set EMAIL_PROVIDER to gmail or resend on the server." };
    const gmail = provider === "gmail";
    const credential = gmail ? process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "") : process.env.RESEND_API_KEY;
    const sender = z.string().trim().email().safeParse(gmail ? process.env.GMAIL_USER : process.env.RESEND_FROM_EMAIL);
    const replyTo = gmail ? process.env.GMAIL_REPLY_TO_EMAIL : process.env.RESEND_REPLY_TO_EMAIL;
    if (!credential || !sender.success || (replyTo && !z.string().email().safeParse(replyTo).success)) {
      return { error: gmail ? "Gmail reminders are not configured yet. Set GMAIL_USER and GMAIL_APP_PASSWORD on the server and check the optional GMAIL_REPLY_TO_EMAIL." : "Email reminders are not configured yet. Set RESEND_API_KEY and a verified RESEND_FROM_EMAIL on the server." };
    }
    const admin = createSupabaseAdmin();
    if (!admin) return { error: "Email reminders need the server's Supabase secret key." };
    const { data: entry, error: readError } = await supabase.from("student_vip_queue").select("*").eq("id", parsed.data.id).maybeSingle<VipQueueEntry>();
    if (readError) return { error: "Unable to check this student's current queue status. Please retry." };
    if (!entry) return { error: "This student is no longer waiting in VIP Queue. Refresh the page." };
    if (entry.student_email && entry.student_email.toLowerCase() !== parsed.data.email) return { error: "The saved student email has changed. Refresh before sending." };
    const payload = { from: `SupplyHub <${sender.data}>`, to: [parsed.data.email], ...vipReminderMessage(entry), ...(replyTo ? { reply_to: replyTo } : {}) };
    const { data: saved, error } = await admin.rpc("prepare_student_vip_reminder", {
      p_id: parsed.data.request_id, p_log_id: entry.id, p_actor_id: user.id, p_email: parsed.data.email, p_payload: payload,
      ...(gmail ? { p_provider: "gmail" } : {}),
    }).single<PreparedReminder>();
    if (error) return { error: error.code === "PGRST202" ? `Email reminders need database setup. Apply ${gmail ? "202610150003_gmail_reminders.sql (after the earlier migrations)" : "202610150002_vip_email_reminders.sql"} first.` : ["22023", "42501", "P0002"].includes(error.code) ? error.message : "Unable to prepare the reminder. Please retry." };
    const reminder = saved;
    if (reminder.accepted_at) return { success: `A reminder was already sent to ${reminder.recipient}. Wait five minutes before sending another.` };
    revalidatePath("/vip-queue");
    revalidatePath("/student-logs");
    let providerId: string;
    if (gmail) {
      const claim = crypto.randomUUID();
      const { data: claimed, error: claimError } = await admin.rpc("claim_student_gmail_reminder", { p_id: reminder.id, p_claim: claim });
      if (claimError) return { error: "Unable to reserve this Gmail send. Check the Gmail reminder migration and retry." };
      if (!claimed) return { error: "This Gmail reminder is already being sent or its delivery is unconfirmed. Ask the administrator to check Gmail Sent before another attempt." };
      const transport = gmailTransport(sender.data, credential);
      try { providerId = await deliverGmailReminder(reminder, mail => transport.sendMail(mail)); }
      catch (error) {
        if (error instanceof GmailDeliveryError && error.retryable) {
          const { error: releaseError } = await admin.rpc("release_student_gmail_reminder", { p_id: reminder.id, p_claim: claim });
          if (releaseError) return { error: "Gmail rejected the reminder, but the attempt could not be reset. Ask the administrator to check its delivery record." };
        }
        return { error: error instanceof GmailDeliveryError ? error.message : "Gmail delivery is unconfirmed. Ask the administrator to check Gmail Sent before another attempt." };
      } finally { transport.close(); }
    } else {
      try { providerId = await deliverVipReminder(reminder, credential); }
      catch (error) { return { error: error instanceof Error && error.name !== "TimeoutError" && error.name !== "TypeError" ? error.message : "The email service did not confirm delivery. Retry this reminder to check safely." }; }
    }
    const { error: recordError } = await admin.rpc("complete_student_vip_reminder", { p_id: reminder.id, p_provider_id: providerId });
    if (recordError) return { error: gmail ? "Gmail accepted the reminder, but its receipt could not be saved. Ask the administrator to reconcile its delivery record; another send is blocked." : "The email service accepted the reminder, but its receipt could not be saved. Retry to confirm without sending it twice." };
    return { success: `Reminder sent to ${reminder.recipient}. Accepted by the email service; inbox delivery may take a moment.` };
  } catch (error) {
    return { error: error instanceof UserFacingError ? error.message : "Unable to confirm this reminder. Please retry." };
  }
}
