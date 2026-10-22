import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AccountProfile, Profile } from "./types";
import { hasVerifiedEmail } from "./email-verification";

// Call only after server-side Super Admin authorization. The admin client stays
// on the server; return profile fields, never Auth credentials or metadata.
export async function loadAccountProfiles(client: SupabaseClient, admin: SupabaseClient): Promise<AccountProfile[]> {
  const users = new Map<string, User>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Unable to load accounts. Please refresh and try again.");
    for (const user of data.users) if (!user.deleted_at) users.set(user.id, user);
    if (data.users.length < 1000) break;
  }
  const ids = [...users.keys()];
  const profiles: AccountProfile[] = [];
  for (let from = 0; from < ids.length; from += 200) {
    const { data, error } = await client.from("profiles")
      .select("id,email,full_name,role,is_active,created_at").in("id", ids.slice(from, from + 200)).returns<Profile[]>();
    if (error) throw new Error("Unable to load account profiles. Please refresh and try again.");
    for (const profile of data ?? []) profiles.push({ ...profile, email_verified: hasVerifiedEmail(users.get(profile.id)) });
  }
  return profiles.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

export async function removeAccount(actor: Profile, targetId: string, client: SupabaseClient, admin: SupabaseClient) {
  if (!actor.is_active || actor.role !== "super_admin") throw new Error("Only an active super admin can remove accounts.");
  if (targetId === actor.id) throw new Error("You cannot remove your own super admin account.");

  const { data: target, error: profileError } = await client.from("profiles").select("id,role").eq("id", targetId).maybeSingle<Pick<Profile, "id" | "role">>();
  if (profileError) throw new Error("Unable to check this account. Please try again.");
  if (!target) throw new Error("Account not found. Refresh the user list.");

  // The existing RPC rechecks the actor's current Super Admin role under the
  // account-access lock. Deactivation blocks existing JWTs through table RLS.
  const { error: accessError } = await client.rpc("set_user_access", {
    p_user_id: targetId, p_role: target.role, p_is_active: false,
  });
  if (accessError) throw new Error(accessError.message);

  try {
    const { data, error: lookupError } = await admin.auth.admin.getUserById(targetId);
    if (lookupError) throw lookupError;
    if (!data.user.deleted_at) {
      // Keep the Auth UUID/profile for restrictive history foreign keys.
      // Supabase removes credentials and sessions; this is not reversible.
      const { error } = await admin.auth.admin.deleteUser(targetId, true);
      if (error) throw error;
    }
  } catch {
    throw new Error("Account access was disabled, but removal could not be completed. Try Remove account again.");
  }
  return "Account removed. Existing inventory and activity records were preserved.";
}
