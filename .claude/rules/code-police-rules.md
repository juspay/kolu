---
paths:
  - "client/**"
---

## Additional Code Police Rules

These rules extend the base code-police skill with Kolu-specific patterns. They are checked during Pass 1 (rule checklist) alongside the generic rules.

### tanstack-use-loading-state

Never check `.data === undefined` as a proxy for loading — use TanStack Query's `.isLoading` or `.isPending`.
_Rationale_: Conflates "loading" with "no data" and misses error states.

### no-query-wrapper-accessors

Don't wrap query properties in accessor functions — export the query object directly.
_Rationale_: Wrapper accessors like `() => query.isLoading` add indirection without value; the query object is already reactive in SolidJS.

### styling-tailwind-only

Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.
