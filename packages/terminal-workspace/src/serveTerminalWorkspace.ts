/**
 * `@kolu/terminal-workspace/serveTerminalWorkspace` — the ONE assembler of the
 * `terminalWorkspaceSurface` server deps, shared by its two homes: kolu-server
 * (in-process) and the `pulam` daemon (remote). The surface SKELETON — the
 * `version` handshake cell + {@link DEFAULT_VERSION}, and the fs/git procedures +
 * watcher streams (off {@link fsGitSurfaceDeps}) spread beside `activity` — lives
 * HERE, once. Each home injects only the two volatile backings:
 *
 *   - `awareness` — the collection's read/write source. kolu-server folds its
 *     local-pulam MIRROR into its registry and projects `.awareness` per entry
 *     (R9.0); `pulam` reads its own store.
 *   - `activity` — the live "bytes moving now" source. Both homes inject a live
 *     source now: kolu the same local-pulam mirror (the local pulam owns the kaval
 *     byte tap), `pulam` its own activity tracker.
 *
 * So a second home is a backing INJECTION, never a second hand-assembled copy of
 * these deps. This is the
 * volatility-boundary twin of `serveFsGit`: the factory hides the surface
 * assembly; only the backing varies. `channel` is the one dep NOT assembled here
 * — each home supplies it (kolu via `implementSurfaces`' shared channel, `pulam`
 * inline), so the return omits it.
 */

import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import type { Logger } from "pino";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";
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
