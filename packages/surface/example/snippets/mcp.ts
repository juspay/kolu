/**
 * Re-exposing the example surface as MCP — the blocks the `@kolu/surface-mcp`
 * reference and the "How to expose a surface to agents" page embed. Build a
 * client for the surface (serve-fresh via `directLink`, or bridge a live one),
 * then name a default-deny allowlist of what an agent may touch.
 */

// #region imports
import { implementSurface } from "@kolu/surface/server";
import { directLink } from "@kolu/surface/links/direct";
import { serveSurfaceAsMcp } from "@kolu/surface-mcp";
// #endregion imports
import { inMemoryChannelByName, inMemoryStore } from "@kolu/surface/server";
import { type Pid, type Proc, surface, ZERO } from "./surface";

const table = new Map<Pid, Proc>();

// #region client
const { router } = implementSurface(surface, {
  channel: inMemoryChannelByName(),
  cells: { load: { store: inMemoryStore(ZERO) } },
  collections: {
    processes: {
      readAll: () => table,
      upsert: (pid, proc) => {
        table.set(pid, proc);
      },
      remove: (pid) => {
        table.delete(pid);
      },
    },
  },
  streams: {
    nodeLog: {
      source: async function* (nodeId) {
        yield { kind: "snapshot", text: `opened ${nodeId}`, done: false };
      },
    },
  },
  events: { autosave: {} },
  procedures: {
    proc: {
      kill: async ({ input, ctx }) => {
        ctx.collections.processes.remove(input.pid);
        return { ok: true };
      },
    },
  },
});
const client = directLink<typeof surface.contract>(router); // serve-fresh
// #endregion client

// #region serve
const { server, close } = await serveSurfaceAsMcp({
  surface,
  client: () => client,
  expose: {
    /* … */
  },
});
// #endregion serve

// #region expose
await serveSurfaceAsMcp({
  surface,
  client: () => client,
  expose: {
    load: "resource", // cell   → readable, subscribable
    nodeLog: "resource", // stream → readable, subscribable
    "proc.kill": { tool: { mutates: true } }, // procedure → mutating tool
    // "proc.configure" omitted → never reaches the agent
  },
});
// #endregion expose

export { client, close, server };
