---
description: Toast notification conventions using solid-sonner
applyTo: "client/src/**"
---

## Toast Conventions

- **Semantic variants**: Use `toast.success()` for success outcomes, `toast.error()` for failures, `toast.warning()` for degraded states (e.g. non-zero exit codes), `toast.info()` for informational notices with actions. Never use bare `toast()` for outcomes — reserve it for neutral notifications (tips, exit-code-0).
- **Colocated, not centralized**: Keep toast calls next to the logic that triggers them (mutation `onError` callbacks, post-`await` success lines). Do not extract into a separate toast helper module.
- **`richColors` is enabled**: The `<Toaster>` has `richColors` set, so semantic variants automatically get colored backgrounds. Choosing the right variant matters for UX.
- **No `toast.promise()`**: Our mutations do post-success work (cache updates, state transitions) after `await mutateAsync()`. Wrapping in `toast.promise()` would braid mutation invocation with toast lifecycle. Use explicit `onError` + post-await `toast.success()` instead.
- **Action toasts**: For persistent notifications requiring user action, use `duration: Infinity` with an `action` prop (see server-update toast in `rpc.ts`).
- **Always surface `err.message`**: When catching errors for toast display, include the server's error message: `.catch((err: Error) => toast.error(\`Failed to X: ${err.message}\`))`. Never swallow the message with a generic string.
