/**
 * Serving the example surface — the `implementSurface` block the
 * `@kolu/surface` reference embeds. `implementSurface` wires every handler and
 * returns a runtime whose `.router` is already the FINAL top-level router,
 * ready to serve over a wire transport.
 */

import {
  type ControlCoreFragment,
  controlCoreSurface,
} from "@kolu/surface-daemon";
import {
  type ImplementSurfaceDeps,
  implementSurface,
  implementSurfaces,
  inMemoryStore,
} from "@kolu/surface/server";
import { type LogFrame, type Pid, type Proc, surface, ZERO } from "./surface";

// Persistence is supplied as plain dependencies — the surface wraps publish.
const table = new Map<Pid, Proc>();
const readAll = (): Map<Pid, Proc> => table;
const upsert = (pid: Pid, proc: Proc): void => {
  table.set(pid, proc);
};
const remove = (pid: Pid): void => {
  table.delete(pid);
};
async function* source(nodeId: string): AsyncIterable<LogFrame> {
  // The first frame of every stream is a fresh full snapshot (the invariant).
  yield { kind: "snapshot", text: `opened ${nodeId}`, done: false };
}

// #region implement
const deps: ImplementSurfaceDeps<typeof surface.spec> = {
  cells: { load: { store: inMemoryStore(ZERO) } },
  collections: { processes: { readAll, upsert, remove } },
  streams: { nodeLog: { source } },
  procedures: {
    proc: {
      kill: async ({ input, ctx }) => {
        ctx.collections.processes.remove(input.pid);
        return { ok: true };
      },
    },
  },
};
const runtime = implementSurface(surface, deps);
// #endregion implement

// #region flatten
// `.router` is already the FINAL flattened router — no re-finalize via oRPC.
const router = runtime.router;
// #endregion flatten

/** The daemon serves the versioned app and frozen core as sibling surfaces. */
export function daemonRouter(control: ControlCoreFragment) {
  return implementSurfaces(
    { app: surface, control: controlCoreSurface },
    {},
    { app: deps, control },
  ).router;
}

export { runtime, router };
