"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult, FormAction } from "@/lib/types";
import { Icon } from "./icons";

function SubmitButton({ label, pendingLabel, disabled }: { label: string; pendingLabel: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" className="sys-button" disabled={pending || disabled}>{pending && <span className="sys-spinner" aria-hidden="true"/>}{pending ? pendingLabel : label}</button>;
}

export function ActionForm({ action, children, submitLabel, pendingLabel = "Saving…", className = "", confirmMessage, disabled }: { action: FormAction; children: ReactNode; submitLabel: string; pendingLabel?: string; className?: string; confirmMessage?: string; disabled?: boolean }) {
  const lastResult = useRef<ActionResult>({});
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, data: FormData) => {
    const result = await action(previous, data);
    lastResult.current = result;
    return result;
  }, {});

  return <form className={`sys-form ${className}`} action={formAction} aria-busy={pending} onSubmit={(event) => {
    if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
  }} onReset={(event) => {
    // A validation error is a completed action, but it must not erase the user's input.
    if (lastResult.current.error) event.preventDefault();
  }}>
    <fieldset className="sys-form-fields" disabled={pending || disabled}>{children}</fieldset>
    <div aria-live="polite" aria-atomic="true">{state.error && <div className="sys-notice sys-notice-error" role="alert"><Icon name="alert"/><p>{state.error}</p></div>}{state.success && <div className="sys-notice sys-notice-success" role="status"><Icon name="check"/><p>{state.success}</p></div>}</div>
    <div className="sys-form-actions"><SubmitButton label={submitLabel} pendingLabel={pendingLabel} disabled={disabled}/></div>
  </form>;
}
