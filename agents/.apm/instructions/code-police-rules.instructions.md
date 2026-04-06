---
description: Kolu-specific code-police rules — subscription and SolidJS patterns
applyTo: "**/*.tsx"
---

## Additional Code Police Rules

These rules extend the base code-police skill with Kolu-specific patterns. They are checked during Pass 1 (rule checklist) alongside the generic rules.

### subscription-use-pending

Never check `sub() === undefined` as a proxy for loading — use `sub.pending()`.
_Rationale_: Conflates "loading" with "no data" and misses error states.

### catch-must-surface-error

When catching an error to show a toast, always include `err.message` in the toast text.
Bad: `.catch(() => toast.error("Failed to set theme"))`
Good: `.catch((err: Error) => toast.error(\`Failed to set theme: ${err.message}\`))`
_Rationale_: Generic error toasts hide the server's actual error message, making debugging impossible. The server returns specific error details via oRPC — surface them.

### styling-tailwind-only

Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.
