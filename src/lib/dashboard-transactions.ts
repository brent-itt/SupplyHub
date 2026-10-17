import "server-only";
import { requireProfile } from "./auth";
import { createSupabaseAdmin } from "./supabase/admin";
import { isManager } from "./types";
import { readDashboardTransactions } from "./dashboard-analytics";

export async function loadDashboardTransactions(start: string, end: string) {
  const { supabase, profile, user } = await requireProfile();
  const manager = isManager(profile.role);
  // Staff cannot read the full ledger through RLS. Expose only their own
  // movements and the fields needed for analytics, after server authorization.
  const client = manager ? supabase : createSupabaseAdmin();
  if (!client) return null;
  return readDashboardTransactions(client, manager ? { all: true } : { actorId: user.id }, start, end);
}
