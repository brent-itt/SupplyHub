import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/validation";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParam = request.nextUrl.searchParams.get("next");
  const next = nextParam === "/reset-password" ? "/reset-password" : safeNext(nextParam);
  if (!code) return NextResponse.redirect(new URL("/login?notice=auth_error", request.url));

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?notice=auth_error", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
