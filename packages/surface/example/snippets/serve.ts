/**
 * Serving the example surface — the `implementSurface` + flatten blocks the
 * `@kolu/surface` reference embeds. `implementSurface` wires every handler and
 * returns a router *fragment*; `implement(contract).router(...)` flattens that
 * fragment once before it is served over a wire transport.
 */

import { implement } from "@kolu/surface/peer-server";
import {
  implementSurface,
  inMemoryChannelByName,
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
const fragment = implementSurface(surface, {
  channel: inMemoryChannelByName(),
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
});
// #endregion implement

// #region flatten
const router = implement(surface.contract).router({ ...fragment.router });
// #endregion flatten

export { fragment, router };
