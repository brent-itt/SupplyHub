import type { ReactNode } from "react";
import { requireProfile } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import { SystemShell } from "@/components/system/shell";

export const dynamic = "force-dynamic";

export default async function SuppliesLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireProfile();
  return <SystemShell profile={profile} action={signOutAction}>{children}</SystemShell>;
}
