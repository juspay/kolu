# @kolu/surface-mcp

Re-expose any [`@kolu/surface`](../surface) as an
[MCP](https://modelcontextprotocol.io/) server, so a coding agent (Claude Code,
Codex, opencode) drives your surface with structured tool calls. Cells,
collections, streams, and events become subscribable **resources**; procedures
become **tools**. A thin adapter that owns the generic parts (the
`resources/subscribe` lifecycle, the Effect Schema → JSON-Schema bridge, stdio discipline)
and leaves you in control of what is exposed, default-deny.

```ts
import { serveSurfaceAsMcp } from "@kolu/surface-mcp";

await serveSurfaceAsMcp({
  surface,
  client: () => client,
  expose: { load: "resource", "proc.kill": { tool: { mutates: true } } },
});
```

Part of the kolu monorepo — `"@kolu/surface-mcp": "workspace:*"`.

## Docs

- How-to — [Expose a surface to agents](https://kolu.dev/surface/expose-to-agents)
- Reference — [@kolu/surface-mcp](https://kolu.dev/surface/ref-surface-mcp)
