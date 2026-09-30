"use client";

import type { FormAction } from "@/lib/types";
import { ActionForm } from "./action-form";

export function ArchiveItemForm({ action, itemId, archived }: { action: FormAction; itemId: string; archived: boolean }) {
  return <ActionForm
    action={action}
    submitLabel={archived ? "Restore supply" : "Archive supply"}
    pendingLabel={archived ? "Restoring…" : "Archiving…"}
    className="sys-compact-form"
    confirmMessage={archived ? "Restore this supply to the active inventory?" : "Archive this supply? It must have zero stock and no pending requisitions."}
  >
    <input type="hidden" name="item_id" value={itemId}/>
    <input type="hidden" name="archived" value={String(!archived)}/>
  </ActionForm>;
}
