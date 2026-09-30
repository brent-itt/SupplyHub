import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "./supabase/server";
import { getSupabaseConfig } from "./supabase/config";
import type { Profile, Role } from "./types";

export const getAuthContext = cache(async () => {
  if (!getSupabaseConfig()) return null;
  const supabase = await createSupabaseServer();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>();
  if (profileError) throw new Error("Unable to read the account profile. Confirm that the Supabase migration has been applied.");
  return { supabase, user, profile };
});

export async function requireProfile(roles?: Role[], next = "/dashboard") {
  if (!getSupabaseConfig()) redirect("/setup");
  const context = await getAuthContext();
  if (!context) redirect("/login?next=" + encodeURIComponent(next));
  if (!context.profile?.is_active) redirect("/access-pending");
  if (roles && !roles.includes(context.profile.role)) redirect("/dashboard?notice=forbidden");
  return { ...context, profile: context.profile };
}

export class UserFacingError extends Error {}

export async function authorizeMutation(roles?: Role[]) {
  const context = await getAuthContext();
  if (!context?.profile?.is_active) throw new UserFacingError("Please sign in with an active account to continue.");
  if (roles && !roles.includes(context.profile.role)) throw new UserFacingError("Your account cannot perform this action.");
  return { ...context, profile: context.profile };
}
