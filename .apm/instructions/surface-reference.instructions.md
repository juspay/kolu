---
description: A surface package's public-API change must update its matching Reference page in the same PR
applyTo: "packages/{surface,surface-app,surface-mcp,surface-daemon,surface-daemon-supervisor,surface-remote,surface-map}/**"
---

## Surface public-API changes must update the Reference docs in the same PR

The `@kolu/surface*` packages each have a **Reference page** in the four-quadrant
Surface docs at `website/src/content/surface/`. Those pages are the austere,
authoritative record of the public API — they are only trustworthy if they move
with the code.

**Any public-API change** to one of these packages — an exported type or function
signature, the oRPC contract shape, package `exports`, a member added to or
removed from `defineSurface`, or any runtime behaviour a documented consumer
wires against — **must update the matching Reference page in the same PR.**

| Package | Reference page |
| --- | --- |
| `@kolu/surface` | `website/src/content/surface/ref-surface.mdx` |
| `@kolu/surface-app` | `website/src/content/surface/ref-surface-app.mdx` |
| `@kolu/surface-mcp` | `website/src/content/surface/ref-surface-mcp.mdx` |
| `@kolu/surface-daemon` | `website/src/content/surface/ref-surface-daemon.mdx` |
| `@kolu/surface-daemon-supervisor` | `website/src/content/surface/ref-surface-supervisor.mdx` |
| `@kolu/surface-remote` | `website/src/content/surface/ref-surface-remote.mdx` |
| `@kolu/surface-map` | `website/src/content/surface/ref-surface-map.mdx` |

- Update the affected entries (names, signatures, tables, snippets) so the page describes the new surface, not the old one. If the change touches an invariant, update `surface-daemon-invariants.mdx` or the relevant Explanation page too.
- "Done" is not done until the page matches the shipped API. This is the mirror, on the docs side, of the drishti-consumer gate in the sibling surface rule — the same "the record must not lie" discipline that the docs themselves are built on.
- Purely internal changes (private helpers, tests, comments, refactors with no observable API delta) do not need a docs update.
- A new export that a consumer is meant to use is an API change: add it to the Reference page. If the package's README changes shape, keep the ~15-line README (identity + install + one snippet + links into the quadrants) pointing at the Reference page rather than duplicating it.
