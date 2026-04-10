---
paths:
  - "client/src/**"
---

## Toast Conventions

- **Semantic variants**: Use `toast.success()` for success outcomes, `toast.error()` for failures, `toast.warning()` for degraded states (e.g. non-zero exit codes), `toast.info()` for informational notices with actions. Never use bare `toast()` for outcomes — reserve it for neutral notifications (tips, exit-code-0).
- **Colocated, not centralized**: Keep toast calls next to the logic that triggers them (mutation `onError` callbacks, post-`await` success lines). Do not extract into a separate toast helper module.
- **`richColors` is enabled**: The `<Toaster>` has `richColors` set, so semantic variants automatically get colored backgrounds. Choosing the right variant matters for UX.
- **Loading toasts for slow operations**: Use `toast.loading()` + update via `{ id }` for operations with perceptible delay (worktree create/remove, session restore). Pattern: `const id = toast.loading("…"); try { await op(); toast.success("…", { id }); } catch (err) { toast.error("…", { id }); throw err; }`. Avoid `toast.promise()` — it returns the toast ID (not the resolved value) and swallows rejections.
- **Action toasts**: For persistent notifications requiring user action, use `duration: Infinity` with an `action` prop (see server-update toast in `rpc.ts`).
- **Always surface `err.message`**: When catching errors for toast display, include the server's error message: `.catch((err: Error) => toast.error(\`Failed to X: ${err.message}\`))`. Never swallow the message with a generic string.
