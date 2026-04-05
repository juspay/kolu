---
paths:
  - "**/*.tsx"
---

## Additional Code Police Rules

These rules extend the base code-police skill with Kolu-specific patterns. They are checked during Pass 1 (rule checklist) alongside the generic rules.

### subscription-use-pending

Never check `.data === undefined` or `sub() === undefined` as a proxy for loading — use `sub.pending()` from `createSubscription`.
_Rationale_: Conflates "loading" with "no data" and misses error states.

### styling-tailwind-only

Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.
