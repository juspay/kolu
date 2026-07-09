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
 * `createTop()` returns the FLATTENED router (ready for `directLink` or a wire
 * server) plus `start`/`dispose`, so the same engine is consumed in-process
 * (see `inproc.ts`) and over a WebSocket (see `main.ts`) — identical code, only
 * the link differs.
 */

import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { implement } from "@orpc/server";
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
  /** Flattened top-level router — pass to `directLink` or a wire server. */
  // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> spread isn't accepted by oRPC's Router<any,T> input type; the runtime shape is valid (the remote-process-monitor agent uses the same cast).
  router: any;
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

  const fragment = implementSurface(surface, {
    channel: inMemoryChannelByName(),
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
        kill: async ({ input }) => {
          try {
            process.kill(input.pid, input.signal);
            return { ok: true };
          } catch {
            return { ok: false };
          }
        },
      },
    },
  });

  const ctx = fragment.ctx;
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

  // `implementSurface` returns a fragment shaped `{ surface: <namespaces> }`.
  // Flatten it once via `implement(contract).router(...)` — passing the raw
  // fragment to a handler double-prefixes the matcher tree (`/surface/surface/…`)
  // and every client request 404s.
  const router = implement(surface.contract).router({ ...fragment.router });

  return {
    router,
    start: () => {
      void tick();
      timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    },
    dispose: () => {
      if (timer) clearInterval(timer);
    },
  };
}
