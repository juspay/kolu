/**
 * Re-exposing the example surface as MCP — the blocks the `@kolu/surface-mcp`
 * reference and the "How to expose a surface to agents" page embed. Build a
 * client for the surface (serve-fresh via `directDispatch`, or bridge a live
 * one), then name a default-deny allowlist of what an agent may touch.
 */

// #region imports
import { buildSurfaceFace } from "@kolu/surface/client";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface } from "@kolu/surface/server";
import {
  serveSurfaceAsMcp,
  type SurfaceClientCallable,
} from "@kolu/surface-mcp";
// #endregion imports
import { inMemoryStore } from "@kolu/surface/server";
import { Effect, Stream } from "effect";
import { type Pid, type Proc, surface, ZERO } from "./surface";

const table = new Map<Pid, Proc>();

// #region client
const runtime = implementSurface(surface, {
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
      source: (nodeId) =>
        Stream.succeed({
          kind: "snapshot" as const,
          text: `opened ${nodeId}`,
          done: false,
        }),
    },
  },
  events: { autosave: {} },
  procedures: {
    proc: {
      kill: ({ input, ctx }) =>
        Effect.sync(() => {
          ctx.collections.processes.remove(input.pid);
          return { ok: true };
        }),
    },
  },
});
// The member face over the in-process dispatch — serve-fresh, no wire.
const client = buildSurfaceFace(surface, directDispatch(runtime));
// #endregion client

// #region serve
const { server, close } = await serveSurfaceAsMcp({
  surface,
  // The cast is surface-mcp's own idiom today: `SurfaceClientCallable` types its
  // member leaves as functions, while `buildSurfaceFace` types them `unknown`
  // (the face is STRUCTURAL by design — D2). The two describe the same runtime
  // value; reconciling the two spellings is a framework follow-up.
  client: () => client as unknown as SurfaceClientCallable,
  expose: {
    /* … */
  },
});
// #endregion serve

// #region expose
await serveSurfaceAsMcp({
  surface,
  // The cast is surface-mcp's own idiom today: `SurfaceClientCallable` types its
  // member leaves as functions, while `buildSurfaceFace` types them `unknown`
  // (the face is STRUCTURAL by design — D2). The two describe the same runtime
  // value; reconciling the two spellings is a framework follow-up.
  client: () => client as unknown as SurfaceClientCallable,
  expose: {
    load: "resource", // cell   → readable, subscribable
    nodeLog: "resource", // stream → readable, subscribable
    "proc.kill": { tool: { mutates: true } }, // procedure → mutating tool
    // "proc.configure" omitted → never reaches the agent
  },
});
// #endregion expose

export { client, close, server };
