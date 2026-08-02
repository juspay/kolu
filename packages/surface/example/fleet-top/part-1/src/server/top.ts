/**
 * The `top` engine — build the surface implementation and drive it.
 *
 * `implementSurface` wires every cell / collection / procedure declared in
 * `common/surface.ts` to a store and a channel; the poll loop then pushes new
 * readings through the framework's typed `ctx` (`ctx.cells.load.set(...)`,
 * `ctx.collections.processes.upsert/remove(...)`), which mutates the snapshot
 * AND publishes the delta in one call. A fresh subscriber's first frame is
 * always a full snapshot (the snapshot-then-delta invariant); per-pid
 * upserts/removes follow.
 *
 * `createTop()` hands back the whole `SurfaceRuntime` — its flat `group` and
 * tag-keyed `handlers` are the pair EVERY transport takes (`directDispatch`
 * in-process, `serveSurfaceSocket` over a websocket, `serveOverStdio` over ssh,
 * `serveOverUnixSocket` for a daemon) — plus `start`/`dispose`. The same engine
 * is therefore consumed in-process and over a wire with identical code; only
 * the transport differs.
 */

import {
  implementSurface,
  inMemoryStore,
  type SurfaceRuntime,
} from "@kolu/surface/server";
import { Effect } from "effect";
import {
  DEFAULT_LOAD,
  DEFAULT_MEMORY,
  type Pid,
  type Process,
  surface,
} from "../common/surface";
import { createTopReader } from "./proc";

const POLL_INTERVAL_MS = 2000;

export interface Top {
  /** The served surface. `runtime.group` + `runtime.handlers` go to a
   *  transport; `runtime.ctx` is the typed write seam the poll loop uses. */
  readonly runtime: SurfaceRuntime<typeof surface.spec>;
  /** Begin polling. */
  start(): void;
  /** Stop polling. */
  dispose(): void;
}

export function createTop(): Top {
  const reader = createTopReader();
  const loadStore = inMemoryStore(DEFAULT_LOAD);
  const memoryStore = inMemoryStore(DEFAULT_MEMORY);
  const processes = new Map<Pid, Process>();

  const runtime = implementSurface(surface, {
    cells: {
      load: { store: loadStore },
      memory: { store: memoryStore },
    },
    collections: {
      processes: {
        readAll: () => processes,
        upsert: (key, value) => {
          processes.set(key, value);
        },
        remove: (key) => {
          processes.delete(key);
        },
      },
    },
    procedures: {
      process: {
        // An imperative procedure returns an `Effect`. `Effect.sync` is the
        // right constructor here: signalling a pid either works or it doesn't,
        // and "it didn't" is part of this procedure's declared RESULT
        // (`{ ok: false }`), not a failure a caller narrows on.
        kill: ({ input }) =>
          Effect.sync(() => {
            try {
              process.kill(input.pid, input.signal);
              return { ok: true };
            } catch {
              return { ok: false };
            }
          }),
      },
    },
  });

  const ctx = runtime.ctx;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async (): Promise<void> => {
    try {
      ctx.cells.load.set(reader.readLoad());
      ctx.cells.memory.set(await reader.readMemory());
      const next = await reader.readProcesses();
      for (const [pid, value] of next) {
        const prev = processes.get(pid);
        if (
          prev === undefined ||
          prev.cpuPct !== value.cpuPct ||
          prev.memPct !== value.memPct ||
          prev.command !== value.command
        ) {
          ctx.collections.processes.upsert(pid, value);
        }
      }
      for (const pid of [...processes.keys()]) {
        if (!next.has(pid)) ctx.collections.processes.remove(pid);
      }
    } catch (err) {
      process.stderr.write(`[top] tick error: ${(err as Error).message}\n`);
    }
  };

  return {
    runtime,
    start: () => {
      void tick();
      timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    },
    dispose: () => {
      if (timer) clearInterval(timer);
    },
  };
}
