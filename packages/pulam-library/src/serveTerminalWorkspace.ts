/**
 * `@kolu/pulam-library/serveTerminalWorkspace` — the ONE assembler of the
 * `terminalWorkspaceSurface` server deps, shared by its two homes: kolu-server
 * (in-process) and the `pulam` daemon (remote). The surface SKELETON — the
 * `version` handshake cell + {@link DEFAULT_VERSION}, and the fs/git procedures +
 * watcher streams (off {@link fsGitSurfaceDeps}) spread beside `activity` — lives
 * HERE, once. Each home injects only the two volatile backings:
 *
 *   - `awareness` — the collection's read/write source. kolu-server PROJECTS it
 *     off its registry (`.awareness` per entry); `pulam` reads its own store.
 *   - `activity` — the live "bytes moving now" source. kolu-server has no raw
 *     byte tap yet, so it passes {@link quietActivity} (R9 turns it live); `pulam`
 *     passes a live source over its activity tracker.
 *
 * So a second home — or R9 turning kolu's activity live — is a backing
 * INJECTION, never a second hand-assembled copy of these deps. This is the
 * volatility-boundary twin of `serveFsGit`: the factory hides the surface
 * assembly; only the backing varies. `channel` is the one dep NOT assembled here
 * — each home supplies it (kolu via `implementSurfaces`' shared channel, `pulam`
 * inline), so the return omits it.
 */

import {
  type ImplementSurfaceDeps,
  inMemoryStore,
  pollOnEvent,
} from "@kolu/surface/server";
import type { Logger } from "pino";
import { type ActivityTracker, sameActivitySet } from "./activity.ts";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";
import type { TerminalId } from "./schema.ts";
import { fsGitSurfaceDeps } from "./serveFsGit.ts";
import { DEFAULT_VERSION, type terminalWorkspaceSurface } from "./surface.ts";

type WorkspaceDeps = ImplementSurfaceDeps<typeof terminalWorkspaceSurface.spec>;

/** The `awareness` collection backing a home injects — kolu-server's
 *  registry projection or `pulam`'s own store. */
export type AwarenessCollectionDeps = NonNullable<
  WorkspaceDeps["collections"]
>["awareness"];

/** The live-`activity` stream backing a home injects. */
export type ActivityStreamDeps = NonNullable<
  WorkspaceDeps["streams"]
>["activity"];

/** A QUIET activity source — yields the empty live set once and never changes.
 *  For a home with no raw byte tap (kolu-server today; R9 makes it live): the
 *  honest "nothing known to be moving", not a lie. A home WITH a tap injects a
 *  live source instead (`pulam`'s `pollOnEvent` over its activity tracker). The
 *  `source` thunk is re-invoked per subscription, so sharing this one value
 *  leaks no per-subscriber state. */
export const quietActivity: ActivityStreamDeps = {
  source: (_input, signal) =>
    pollOnEvent<TerminalId[]>({
      // The live set is constant-empty: `read` returns `[]` and touches no I/O,
      // so it cannot fail — `onReadError` is unreachable, intentionally empty
      // (not a swallowed error). `install` never fires (nothing changes).
      read: async () => [],
      isEqual: () => true,
      install: () => () => {},
      signal,
      onReadError: () => {},
    }),
};

/** A LIVE activity source over a home-owned {@link ActivityTracker} — the source
 *  a home with a raw byte tap injects instead of {@link quietActivity}. Both homes
 *  use this one builder (the `pulam` daemon over its per-host tracker; kolu-server
 *  over the tracker its `watchTerminalAwareness` taps feed), so the served
 *  `activity` stream is assembled ONE way, never re-derived per home. Re-yields the
 *  whole live set whenever a terminal lights up or goes quiet; `sameActivitySet`
 *  suppresses the redundant yield when a timer re-arm left the set unchanged. The
 *  `source` thunk is re-invoked per subscription, so the single shared tracker
 *  carries no per-subscriber state. */
export function liveActivity(tracker: ActivityTracker): ActivityStreamDeps {
  return {
    source: (_input, signal) =>
      pollOnEvent<TerminalId[]>({
        // `tracker.snapshot()` is a pure in-memory sort over the live Set — it
        // touches no I/O, so it cannot fail: `onReadError` is unreachable,
        // intentionally empty (not a swallowed error). Mirrors `quietActivity`.
        read: async () => tracker.snapshot(),
        isEqual: sameActivitySet,
        install: (onEvent) => tracker.onChange(onEvent),
        signal,
        onReadError: () => {},
      }),
  };
}

/** Assemble the FULL `terminalWorkspaceSurface` server deps (minus `channel`,
 *  which each home supplies). The `version` cell and the fs/git procedures +
 *  watcher streams are built HERE off the injected `endpoint`; the caller injects
 *  only the `awareness` collection and the `activity` source. Spread the result
 *  into `implementSurface(...)` (`pulam`) or hand it as the `terminalWorkspace`
 *  sibling deps (kolu-server). */
export function serveTerminalWorkspace(deps: {
  awareness: AwarenessCollectionDeps;
  activity: ActivityStreamDeps;
  endpoint: TerminalWorkspaceEndpoint;
  log: Logger;
}): Omit<WorkspaceDeps, "channel"> {
  const fsGit = fsGitSurfaceDeps(deps.endpoint, deps.log);
  return {
    cells: { version: { store: inMemoryStore(DEFAULT_VERSION) } },
    collections: { awareness: deps.awareness },
    streams: { activity: deps.activity, ...fsGit.streams },
    procedures: fsGit.procedures,
  };
}
