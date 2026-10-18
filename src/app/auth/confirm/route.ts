import { NextResponse, type NextRequest } from "next/server";
import { hasVerifiedEmail, verificationClient } from "@/lib/email-verification";
import { getSupabaseConfig } from "@/lib/supabase/config";

export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const config = getSupabaseConfig();
  let destination = "/verify-email?notice=auth_error";
  if (config && token_hash && token_hash.length <= 512 && (type === "email" || type === "signup")) {
    try {
      const { data, error } = await verificationClient(config.url, config.key).auth.verifyOtp({ token_hash, type });
      if (!error && hasVerifiedEmail(data.user)) destination = "/login?notice=email_verified";
    } catch {
      // A failed/expired link must not grant access or expose provider errors.
    }
  }
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
