# @kolu/surface-mcp

Re-expose a [`@kolu/surface`](../surface) **rooted bundle** — a bare core beside
a keyed set of siblings, the roster changing live — as an
[MCP](https://modelcontextprotocol.io/) server, so a coding agent (Claude Code,
Codex, opencode) drives your surface with structured tool calls. Cells,
collections, streams, and events become subscribable **resources**; procedures
become **tools**. A thin adapter that owns the generic parts (the
`resources/subscribe` lifecycle, the Effect Schema → JSON-Schema bridge, stdio discipline)
and leaves you in control of what is exposed, default-deny.

```ts
import { serveSurfaceAsMcp } from "@kolu/surface-mcp";

const served = await serveSurfaceAsMcp({
  core: { surface, expose: { load: "resource" } },
  surfaces: {
    tenantA: { surface, expose: { "proc.kill": { tool: { mutates: true } } } },
  },
  client: () => ({ core, clients: { tenantA } }),
});

// The sibling key is a segment of every DERIVED name it contributes:
//   surface://cells/load          tenantA_proc_kill
// A hand-authored `tools` entry keeps the name its author wrote.
await served.reroster({ /* the new sibling map, whole */ });
```

Part of the kolu monorepo — `"@kolu/surface-mcp": "workspace:*"`.

## Docs

- How-to — [Expose a surface to agents](https://kolu.dev/surface/expose-to-agents)
- Reference — [@kolu/surface-mcp](https://kolu.dev/surface/ref-surface-mcp)
