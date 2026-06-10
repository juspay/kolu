# @kolu/surface-mcp

Re-expose any [`@kolu/surface`](../surface) as an [MCP](https://modelcontextprotocol.io/) server, so a coding agent (Claude Code, Codex, opencode, Gemini CLI) can drive your surface with structured tool calls instead of scraping output.

A surface already *is* a typed, live, snapshot-then-delta interface — cells, collections, streams, events, and procedures. MCP wants resources, notifications, and tools. The correspondence is close, so this package is a thin-ish adapter: **it owns the parts that are genuinely generic** — the `resources/subscribe` → `notifications/resources/updated` lifecycle (with correct teardown), the zod → JSON-Schema bridge, and the stdio discipline — and leaves you in control of **what** is exposed and **how** it's curated.

It generalizes the hand-built `src/mcp/` face of [odu](https://github.com/juspay/odu), kolu's CI runner.

## Install

```jsonc
// package.json
{ "dependencies": { "@kolu/surface-mcp": "workspace:*" } }
```

## Usage

`serveSurfaceAsMcp` takes the surface spec, a **client factory** for a live implementation of it, and a **default-deny `expose` allowlist** — then builds and connects an MCP server.

```ts
import { directLink, implementSurface } from "@kolu/surface/server";
import { serveSurfaceAsMcp } from "@kolu/surface-mcp";

const { router } = implementSurface(surface, deps);          // your surface, implemented
const client = directLink<typeof surface.contract>(router);  // an in-process client

await serveSurfaceAsMcp({
  surface,
  client: () => client,
  // default-deny: anything omitted is unreachable by the agent
  expose: {
    nodes: "resource",                          // cell    → a subscribable resource
    log: "resource",                            // stream  → a subscribable resource
    "node.rerun": { tool: { mutates: true } },  // procedure → a tool (marked mutating)
    // "run.configure" is omitted → it never reaches the host
  },
});
// → an MCP server over stdio. Point an agent at it via .mcp.json.
```

### Two shapes

- **Serve fresh** — `client` is a `directLink` over an in-process `implementSurface` (above). The MCP server *is* the surface's backend.
- **Bridge a live surface** — `client` dials an already-running served surface (a socket, ssh stdio). The MCP server is a *face* on a server that already exists. This is odu's case (`odu mcp` dials `.ci/odu.sock`).

### Default-deny `expose`

Nothing is exposed until you name it. Keys are checked against the surface spec at boot.

- a **cell / collection / stream / event** key → `"resource"` (readable + subscribable).
- a **procedure** key `"<ns>.<verb>"` → `"tool"` or `{ tool: { mutates?: boolean } }`. The tool is named `<ns>_<verb>` on the wire (`.` is illegal in an MCP tool name).

Resource URIs: `surface://cells/<k>`, `surface://collections/<k>` (+ template `surface://collections/<k>/{id}`), `surface://streams/<k>`, `surface://events/<k>`.

### Bespoke tools

Not everything is surface-shaped. For genuinely call-shaped capabilities (spawn-and-wait, blocking polls), hand-author a tool whose handler composes over the live client — it still rides the package's JSON-Schema bridge and lifecycle:

```ts
import { z } from "zod";

await serveSurfaceAsMcp({
  surface, client: () => client, expose: { /* … */ },
  tools: {
    run: {
      description: "Start the run and wait until its socket is live.",
      input: z.object({ strict: z.boolean().default(true) }),
      mutates: true,
      handler: (args, client, signal) => spawnAndAwait(args, signal),
    },
  },
});
```

### Curating with `projectSurface`

The cleanest way to decide *what an agent may touch* is to expose a **curated second surface** rather than the raw one — project the live surface into an observer-safe view (drop the dangerous procedures, bound the logs, derive the verdicts), then serve *that*. See [`projectSurface`](../surface#projection-a-server-thats-a-client) in `@kolu/surface`.

## API

- `serveSurfaceAsMcp(opts) → Promise<{ server, close }>` — `opts: { surface, client, expose, tools?, serverInfo?, transport? }`. `transport` defaults to a `StdioServerTransport`; inject an in-memory transport half for tests.
- `toInputSchema(schema?) → JSON Schema` — `z.toJSONSchema` (draft 2020-12, `io:"input"`, `unrepresentable:"any"`) plus a `$ref`-dereference pass and top-level-object enforcement, so the emitted schema works across MCP clients that don't follow `$ref`.
- `resolveExpose(spec, expose) → { resources, resourceTemplates, tools }` — the default-deny resolver (exported for tooling/tests).
- types: `ExposeMap`, `BespokeTool`, `ToolResult`, `ServeSurfaceAsMcpOptions`, `SurfaceClientOf`.

## Design

The full design — why the lifecycle spine is the framework primitive, the zod→JSON-Schema buy-plus-glue, and the curation-as-a-projected-surface cut — is the Atlas note [`surface-mcp`](../../docs/atlas/src/content/atlas/surface-mcp.mdx) (kolu#982).

## License

MIT.
