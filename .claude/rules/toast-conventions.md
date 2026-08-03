---
paths:
  - "packages/client/src/**"
---

## Toast Conventions

- **Semantic variants**: Use `toast.success()` for success outcomes, `toast.error()` for failures, `toast.warning()` for degraded states (e.g. non-zero exit codes), `toast.info()` for informational notices with actions. Never use bare `toast()` for outcomes — reserve it for neutral notifications (tips, exit-code-0).
- **Colocated, not centralized**: Keep toast calls next to the logic that triggers them (mutation `onError` callbacks, post-`await` success lines). Do not extract into a separate toast helper module.
- **`richColors` is enabled**: The `<Toaster>` has `richColors` set, so semantic variants automatically get colored backgrounds. Choosing the right variant matters for UX.
- **Loading toasts for slow operations**: Use `toast.loading()` + update via `{ id }` for operations with perceptible delay (worktree create/remove, session restore). The op is an `Effect`, so the three phases are combinators rather than `try`/`catch`: `const id = toast.loading("…")` in an `Effect.sync`, then `Effect.tap` the success line and `Effect.tapError` the failure one, both passing `{ id }` so they update the same toast in place. Avoid `toast.promise()` — it returns the toast ID (not the resolved value) and swallows rejections.
- **Action toasts**: For persistent notifications requiring user action, use `duration: Infinity` with an `action` prop (see server-update toast in `rpc.ts`).
- **Always surface the error's message**: When reporting a failure, include the server's message — `Effect.catch((err) => Effect.sync(() => toast.error(\`Failed to X: ${message(err)}\`)))`. Never swallow it with a generic string. A procedure call is an `Effect`, so its failure arrives in the error channel and is handled with `Effect.catch` / `Effect.catchTag` / `Effect.tapError`, not `.catch()`; the program then reaches the DOM through `runAction(label, program)`. See `.claude/rules/solidjs.md` for that edge.
