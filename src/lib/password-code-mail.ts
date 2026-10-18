import "server-only";
import { z } from "zod";
import { gmailTransport } from "./gmail-reminder";

export function passwordCodeSender() {
  const provider = process.env.EMAIL_PROVIDER?.trim() || "resend";
  const gmail = provider === "gmail";
  const from = gmail ? process.env.GMAIL_USER : process.env.RESEND_FROM_EMAIL;
  const credential = gmail ? process.env.GMAIL_APP_PASSWORD : process.env.RESEND_API_KEY;
  if (!["gmail", "resend"].includes(provider) || !z.string().email().safeParse(from).success || !credential) {
    throw new Error("Password verification email delivery is not configured.");
  }
  return async (email: string, code: string) => {
    const mail = {
      from: `SupplyHub <${from}>`, to: email,
      subject: "Your SupplyHub password change verification code",
      text: `Your verification code is: ${code}\n\nEnter this code in My account to change your SupplyHub password. It is valid for 10 minutes and can be used once.\n\nIf you did not request this change, do not share the code. Your password has not been changed.`,
    };
    if (gmail) {
      const transport = gmailTransport(from!, credential);
      try {
        const result = await transport.sendMail(mail);
        if (!result.accepted.length) throw new Error("Delivery rejected");
      } finally { transport.close(); }
    } else {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...mail, to: [email] }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Delivery rejected");
    }
  };
}
