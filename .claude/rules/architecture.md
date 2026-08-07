---
paths:
  - "{README.md,website/src/content/docs/architecture.mdx}"
---

## Architecture (docs)

- The canonical architecture write-up is the **kolu.dev docs** page at `website/src/content/docs/architecture.mdx` (served at <https://kolu.dev/architecture>): the daemon stack (PWA client · kolu-server · padi · kaval), how the layers talk over the wire (the single websocket + Effect RPC over ndjson + the same-origin gate), the two data-flow loops, and the package map — with hand-authored SVG diagrams (the site has no mermaid). **Read it before declaring done** on any structural change, and update every part that no longer matches (the stack table + SVG, the communication section, the data-flow loops + SVG, the package map).
- The root `README.md` Architecture section is now only a **pointer** to that page — do not re-grow the package table, the communication tables, or the data-flow diagram there. The README is a map; the kolu.dev docs are canonical.
