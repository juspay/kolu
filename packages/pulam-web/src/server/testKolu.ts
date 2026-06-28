/**
 * Shared pulam-web server-test fixture: a stand-in `terminalWorkspaceSurface`
 * agent over `directLink`, plus the scaffolding every server test repeats.
 *
 * `standUpAgent` is the one "a real agent surface, in-process, no ssh/Nix"
 * helper both `reserve.test.ts` (the agent → mirror → re-serve → browser leg) and
 * `localKolu.test.ts` (the localhost-dedup differential) stand up — parameterized
 * for the only two things they vary: the awareness seed and the activity yield. A
 * contract change to `terminalWorkspaceSurface` then forces ONE edit here, not a
 * parallel edit per test file. `browserLink`, `waitFor`, and `useDisposers` are
 * the same-shape scaffolding both files used verbatim.
 */

import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { seedAwarenessValue } from "@kolu/terminal-workspace";
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import { afterEach, expect, vi } from "vitest";
import type {
  PulamBrowserContract,
  PulamContract,
} from "../shared/contract.ts";

/** Two real UUID terminal ids (the collection's key schema is `z.string().uuid()`,
 *  so a bare "A"/"B" would fail validation at the agent's collection boundary). */
export const TERM_A = "11111111-1111-4111-8111-111111111111" as TerminalId;
export const TERM_B = "22222222-2222-4222-8222-222222222222" as TerminalId;

export interface StandUpAgentOptions {
  /** Seed the awareness cache. Default: a single working agent on TERM_A — the
   *  base reserve-test fixture. localKolu passes its own state-bearing seed. */
  seed?: ReadonlyMap<TerminalId, AwarenessValue>;
  /** A hand-fed activity feed; when present the activity stream forwards each
   *  frame, so the live-set is deterministic rather than snapshot-timing-dependent. */
  activityFeed?: AsyncIterable<TerminalId[]>;
  /** The lone snapshot frame the activity stream yields when no `activityFeed`
   *  is wired: defaults to the current awareness key set (reserve.test's stand-in
   *  agent), or `[]` for a quiet kolu stand-in (localKolu's — kolu serves a quiet
   *  live-set). */
  quietLiveSet?: readonly TerminalId[];
  /** Back the awareness collection the way KOLU-SERVER does — a registry PROJECTION
   *  whose `upsert`/`remove` are NO-OPS (the registry IS the store) and whose entry
   *  is added to the backing BEFORE the publishing `ctx.upsert` runs. The pulam
   *  DAEMON instead uses a real Map `upsert` (the default here). The two differ in
   *  exactly the case R9a's membership bug lived in: a Map `upsert` ADDS the key, so
   *  the framework's keys-delta fires; a registry projection's no-op `upsert` on an
   *  already-inserted key would (pre-fix) suppress it. localKolu's stand-in passes
   *  `true` so it models kolu faithfully; use `publish`/`drop` to mutate it. */
  registryBacked?: boolean;
}

/**
 * Stand up a REAL `terminalWorkspaceSurface` agent over `directLink`. The
 * awareness collection is backed by the returned `cache` Map and driven through
 * the returned `ctx` — pushing a delta is `ctx.collections.awareness.upsert(...)`
 * / `.remove(...)`, exactly what the daemon's sensors (or kolu's) do. Every other
 * primitive is implemented minimally (it must be: `implementSurface` fail-fast
 * THROWS on any unimplemented one) — they're never exercised, but their presence
 * proves the consumer grafts onto a COMPLETE agent surface.
 */
export function standUpAgent(opts: StandUpAgentOptions = {}) {
  const cache = opts.seed
    ? new Map(opts.seed)
    : new Map<TerminalId, AwarenessValue>([
        [TERM_A, seedAwarenessValue("/work/repo-a")],
      ]);

  // The agent serves the BASE surface (connection-free) — link health is the
  // PARENT's, added only at the re-serve seam via `mirroredSurface`.
  const { router, ctx } = implementSurface(terminalWorkspaceSurface, {
    channel: inMemoryChannelByName(),
    cells: { version: { store: inMemoryStore({ ...DEFAULT_VERSION }) } },
    collections: {
      // kolu-server projects awareness off its registry (no-op upsert/remove); the
      // pulam daemon writes a real Map. `registryBacked` picks the kolu pattern.
      awareness: opts.registryBacked
        ? { readAll: () => cache, upsert: () => {}, remove: () => {} }
        : {
            readAll: () => cache,
            upsert: (key, value) => {
              cache.set(key, value);
            },
            remove: (key) => {
              cache.delete(key);
            },
          },
    },
    streams: {
      // Live-set source. With a feed, forward each frame; otherwise yield ONE
      // snapshot frame (the awareness key set, or the caller's `quietLiveSet`).
      activity: {
        source: opts.activityFeed
          ? async function* (_input, signal) {
              for await (const frame of opts.activityFeed as AsyncIterable<
                TerminalId[]
              >) {
                if (signal?.aborted) break;
                yield frame;
              }
            }
          : async function* () {
              yield opts.quietLiveSet
                ? [...opts.quietLiveSet]
                : [...cache.keys()];
            },
      },
      // Minimal watcher sources — one snapshot pulse, then done. Not exercised.
      subscribeRepoChange: {
        source: async function* () {
          yield { seq: 0 };
        },
      },
      subscribeFileChange: {
        source: async function* () {
          yield { seq: 0 };
        },
      },
    },
    // Minimal fs/git — canned, schema-valid, never called.
    procedures: {
      fs: {
        listAll: () => ({ paths: [] }),
        readFile: () => ({ content: "", truncated: false }),
        statFileMtimeMs: () => 0,
      },
      git: {
        getStatus: ({ input }) =>
          input.mode === "local"
            ? {
                mode: "local" as const,
                files: [],
                branch: { name: "main", upstream: null, ahead: 0, behind: 0 },
                workingTree: { staged: 0, modified: 0, untracked: 0 },
              }
            : { mode: "branch" as const, files: [], base: null },
        getDiff: () => ({
          oldFileName: null,
          newFileName: null,
          hunks: [],
          binary: false,
        }),
      },
    },
  });

  // A `directLink` client is structurally what both callers consume: the mirror
  // source (reserve) and `KoluLink["client"]` (localKolu) — the latter's
  // `AgentClient<PulamContract>` is assignable from this at its call site.
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — the implementSurface router's Lazy<Router> spread isn't accepted by directLink's input type; the runtime shape is valid.
  const client = directLink<PulamContract>(router as any);
  return {
    cache,
    ctx,
    client,
    /** Publish an awareness value the way kolu's `installAwareness` /
     *  `updateServer*Metadata` do: mutate the registry (the `cache`) FIRST, then fan
     *  out through `ctx` — so a terminal BORN after a consumer subscribed exercises
     *  the registry-backed keys delta a Map `ctx.upsert` would mask. Works for both
     *  backings (the Map `upsert`'s own `cache.set` is then idempotent). */
    publish(id: TerminalId, value: AwarenessValue): void {
      cache.set(id, value);
      ctx.collections.awareness.upsert(id, value);
    },
    /** Drop a terminal the way kolu's `dropAwareness` does: registry entry gone
     *  first, then the `ctx` removal that tells subscribers. */
    drop(id: TerminalId): void {
      cache.delete(id);
      ctx.collections.awareness.remove(id);
    },
  };
}

/** A `directLink` to a re-serve router, typed over the BROWSER contract
 *  (`pulamSurface` = base + connection) — the same read the browser leg makes. */
export function browserLink(router: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: documented fragment→client cast — runtime shape is valid.
  return directLink<PulamBrowserContract>(router as any);
}

/** Poll until `predicate()` holds — delegates to `vi.waitFor` (Vitest's built-in
 *  retry loop) so the clock for the async fold (mirror frame → re-serve publish →
 *  Solid effect flush) stays consistent across the suite. */
export async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 1000 } = {},
): Promise<void> {
  await vi.waitFor(() => expect(predicate()).toBe(true), {
    timeout: timeoutMs,
  });
}

/** Per-test teardown registry: returns a `disposers` array and wires the
 *  `afterEach` that drains it (best-effort, so one teardown throw can't mask the
 *  rest). Call once at a test file's top level — the `afterEach` registers on
 *  that file's suite. */
export function useDisposers(): Array<() => void> {
  const disposers: Array<() => void> = [];
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* best-effort teardown */
      }
    }
  });
  return disposers;
}
