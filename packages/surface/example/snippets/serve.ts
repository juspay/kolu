/**
 * Serving the example surface — the `implementSurface` block the
 * `@kolu/surface` reference embeds. `implementSurface` wires every handler and
 * returns a `SurfaceRuntime`: the flat `group` (one `Rpc` per wire tag,
 * `surface/<member>/<verb>`) and the tag-keyed `handlers`. That PAIR is what
 * every transport takes — `serveOverStdio`, `serveOverUnixSocket`,
 * `serveSurfaceSocket`, or `directDispatch` in-process. There is no router to
 * finalize: a tag carries its own route.
 */

import {
  type ImplementSurfaceDeps,
  implementSurface,
  inMemoryStore,
} from "@kolu/surface/server";
import { Effect, Stream } from "effect";
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
// A stream member's source is Effect-native: it returns a `Stream`, and
// cancellation is fiber INTERRUPTION — no `AbortSignal` to thread, none to
// forget. `Stream.suspend` defers the work to subscribe time.
const source = (nodeId: string): Stream.Stream<LogFrame> =>
  Stream.suspend(() =>
    // The first frame of every stream is a fresh full snapshot (the invariant).
    Stream.succeed({ kind: "snapshot", text: `opened ${nodeId}`, done: false }),
  );

// #region implement
export const deps: ImplementSurfaceDeps<typeof surface.spec> = {
  cells: { load: { store: inMemoryStore(ZERO) } },
  collections: { processes: { readAll, upsert, remove } },
  streams: { nodeLog: { source } },
  procedures: {
    proc: {
      // A procedure returns an `Effect`. Its DECLARED failures are the spec's
      // `error` schema (none here); an undeclared throw stays a DEFECT.
      kill: ({ input, ctx }) =>
        Effect.sync(() => {
          ctx.collections.processes.remove(input.pid);
          return { ok: true };
        }),
    },
  },
};
const runtime = implementSurface(surface, deps);
// `runtime.group` + `runtime.handlers` go straight to a transport.
// #endregion implement

export { runtime };
