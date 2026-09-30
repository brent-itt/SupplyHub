"use client";

import type { FormAction } from "@/lib/types";
import type { ReactNode } from "react";
import { ActionForm } from "./action-form";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="sys-field"><span>{label}</span>{children}</label>;
}

export function SignInForm({ action, next }: { action: FormAction; next: string }) {
  return <ActionForm action={action} submitLabel="Sign in" pendingLabel="Signing in…">
    <input type="hidden" name="next" value={next}/>
    <Field label="Email address"><input className="sys-input" name="email" type="email" autoComplete="username" maxLength={254} required/></Field>
    <Field label="Password"><input className="sys-input" name="password" type="password" autoComplete="current-password" maxLength={128} required/></Field>
  </ActionForm>;
}

export function PasswordResetRequestForm({ action }: { action: FormAction }) {
  return <ActionForm action={action} submitLabel="Send reset link" pendingLabel="Sending…">
    <Field label="Email address"><input className="sys-input" name="email" type="email" autoComplete="email" maxLength={254} required/></Field>
  </ActionForm>;
}

export function PasswordUpdateForm({ action }: { action: FormAction }) {
  return <ActionForm action={action} submitLabel="Update password" pendingLabel="Updating…">
    <Field label="New password"><input className="sys-input" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required/></Field>
    <p className="sys-form-hint">Use at least 12 characters.</p>
  </ActionForm>;
}
