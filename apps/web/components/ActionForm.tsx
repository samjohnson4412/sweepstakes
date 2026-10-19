"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions";

/** Form wrapper for server actions that return `{ error | message | token }`. */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? "stack"}>
      {children}
      {state?.error && <div className="notice error">{state.error}</div>}
      {state?.message && <div className="notice">{state.message}</div>}
      {state?.token && (
        <div className="notice warn">
          Copy this token into the extension now; it won't be shown again:
          <br />
          <code>{state.token}</code>
        </div>
      )}
      <div>
        <button disabled={pending}>{pending ? "Working…" : submitLabel}</button>
      </div>
    </form>
  );
}
