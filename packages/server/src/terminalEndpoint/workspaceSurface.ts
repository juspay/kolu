/**
 * R8 — kolu-server's IN-PROCESS implementation of `terminalWorkspaceSurface`.
 *
 * R6 shipped one fs/git IMPL (`createTerminalWorkspaceEndpoint`) with two homes
 * but two different contract SHAPES. R8 closes that: kolu-server now serves the
 * whole `terminalWorkspaceSurface` itself — the same surface arivu serves
 * remotely — as a member of the surface it serves the browser. This module
 * builds the server-only deps for that member: the awareness collection, the
 * activity stream, the version handshake, and the fs/git procedures + watcher
 * streams (off the SAME endpoint instance R6 already bound for the in-process
 * `TerminalEndpoint`).
 *
 * The PER-TERMINAL DISPATCH SEAM is `awarenessFor` / `awarenessAll`: given a
 * terminal, they answer "who serves this terminal's awareness?". Today every
 * terminal is local, so they project the in-process registry record. R9 adds the
 * remote arm — a `{ kind: "remote", hostId }` terminal's awareness comes off that
 * host's mirror — at THIS one seam; the surface, its wire, and the client join
 * are unchanged. That is the whole point of doing R8 before R9: the remote dial
 * becomes a backing swap here, not a second data path.
 */

import { type ImplementSurfaceDeps, inMemoryStore } from "@kolu/surface/server";
import {
  type AwarenessValue,
  DEFAULT_VERSION,
  type TerminalId,
  type terminalWorkspaceSurface,
} from "@kolu/terminal-workspace/surface";
import { fsGitSurfaceDeps } from "@kolu/terminal-workspace/serveFsGit";
import type {
  TerminalEndpointFs,
  TerminalEndpointGit,
} from "@kolu/terminal-workspace/endpoint";
import { activeArm, projectAwareness } from "kolu-common/surface";
import type { Logger } from "pino";
import { getTerminal, listTerminals } from "../terminal-registry.ts";

/** Project one terminal's live awareness, or `undefined` when it has none —
 *  absent, or sleeping (a sleeping terminal's PTY is released, so there is no
 *  live sensor; its frozen cwd/git/pr ride kolu's own `terminalMetadata` arm,
 *  not this collection). THE DISPATCH SEAM (single-terminal arm). R9 adds:
 *  `if (location.kind === "remote") return remoteMirror(location.hostId).awareness.get(id)`. */
function awarenessFor(id: TerminalId): AwarenessValue | undefined {
  const term = getTerminal(id);
  const live = activeArm(term?.meta);
  return live ? projectAwareness(live) : undefined;
}

/** Project EVERY live terminal's awareness — the collection snapshot a fresh
 *  subscriber reads. THE DISPATCH SEAM (whole-set arm); local-only today. */
function awarenessAll(): Map<TerminalId, AwarenessValue> {
  const map = new Map<TerminalId, AwarenessValue>();
  for (const info of listTerminals()) {
    const value = awarenessFor(info.id);
    if (value) map.set(info.id, value);
  }
  return map;
}

/** Build the server-only deps for the composed `terminalWorkspaceSurface`,
 *  backed by kolu-server's in-process fs/git endpoint (the R6 impl, reused — one
 *  impl, now also one surface). Spread into the `implementSurfaces(...)` deps map
 *  under the `terminalWorkspace` key, beside `kolu` + `surfaceApp`. */
export function buildWorkspaceSurfaceDeps(
  fsGit: { fs: TerminalEndpointFs; git: TerminalEndpointGit },
  log: Logger,
): Omit<ImplementSurfaceDeps<typeof terminalWorkspaceSurface.spec>, "channel"> {
  const { procedures, streams: watcherStreams } = fsGitSurfaceDeps(fsGit, log);
  return {
    cells: {
      // The version handshake — the build's own contract version, never mutated
      // (a remote R9 dialer gates skew on it via `isContractVersionCompatible`).
      version: { store: inMemoryStore(DEFAULT_VERSION) },
    },
    collections: {
      // Server-internal collection (mirrors `terminalMetadata`): `readAll`/
      // `readOne` project the registry through the dispatch seam; `upsert`/`remove`
      // are no-ops because the publish path (`metadata.ts`) calls
      // `workspaceSurfaceCtx.collections.awareness.upsert(id, value)` to PUSH to
      // subscribers — the registry, not this collection, is the store.
      awareness: {
        readAll: awarenessAll,
        readOne: (key) => awarenessFor(key as TerminalId),
        upsert: () => {},
        remove: () => {},
      },
    },
    streams: {
      // R8 is local-only, and kolu's local liveness (the green dot) is already
      // derived CLIENT-side from the attach byte stream (`useTerminalActivity`) —
      // so kolu has no server-side activity tracker to feed here. Serve a quiet
      // snapshot (empty set, held open) to satisfy the composed surface; R9
      // sources a REMOTE terminal's liveness off the mirror's `activity` stream.
      activity: {
        source: async function* (_input, signal): AsyncGenerator<TerminalId[]> {
          yield [];
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      // The fs/git change-pulse watchers — per-subscription `{seq}` pulse sources
      // off kolu-git's refcounted watchers (the R6 `serveFsGit` deps).
      ...watcherStreams,
    },
    // The fs/git read procedures (listAll · readFile · statFileMtimeMs · getStatus
    // · getDiff), off the same endpoint instance the in-process TerminalEndpoint uses.
    procedures,
  };
}
