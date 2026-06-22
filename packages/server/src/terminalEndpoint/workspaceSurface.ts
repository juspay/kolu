/**
 * R8 — kolu-server's IN-PROCESS implementation of `terminalWorkspaceSurface`,
 * and the in-process OBSERVATION store behind it.
 *
 * A terminal is two things, and they were never one record:
 *   - AUTHORED state (kolu writes, durable) — location, theme/layout chrome,
 *     lifecycle (active/sleeping + the frozen dormant snapshot). Lives on the
 *     registry's `entry.meta` and rides `koluSurface.terminalMetadata`.
 *   - OBSERVED state (the sensors derive, ephemeral, never persisted) — cwd,
 *     git, pr, agent, foreground. Lives HERE, in the in-process `awareness`
 *     store, served on `terminalWorkspaceSurface.awareness` (in-process locally;
 *     a remote host's is mirrored in R9).
 *
 * kolu no longer HOLDS a copy of the observation folded into its record — it
 * READS the observation through one seam, `awarenessFor(id)` / `awarenessAll()`.
 * Today they read this local store; R9 swaps the backing for a host's mirror
 * behind the same synchronous signature. That is the whole point of composing
 * the surface in R8 before dialing in R9: the remote dial is a backing swap, not
 * a second data path.
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
import type { Logger } from "pino";

// ── The in-process observation store ──────────────────────────────────────
//
// One undivided `AwarenessValue` per LIVE terminal — the sensors' home. The
// sensor sink writes through `workspaceSurfaceCtx.collections.awareness.upsert`,
// which lands here (the collection's `upsert` dep below) AND pushes to
// subscribers; `awarenessFor`/`awarenessAll` read it back. A sleeping terminal
// has no live sensor, so it has NO entry here — its last-observed cwd/git/pr are
// frozen onto kolu's own sleeping record instead (authored snapshot).
const awareness = new Map<TerminalId, AwarenessValue>();

/** Read one terminal's live observation, or `undefined` (absent / sleeping).
 *  THE OBSERVATION SEAM (single-terminal arm). The three server-side observation
 *  readers — transcript export, the Claude-session count, the iframe-preview
 *  route — go through this rather than reaching into kolu's record. R9 reads a
 *  remote terminal's value off its mirror here; the signature is unchanged. */
export function awarenessFor(id: TerminalId): AwarenessValue | undefined {
  return awareness.get(id);
}

/** Read every live terminal's observation — the collection snapshot a fresh
 *  subscriber reads, and the whole-set arm of the seam. Local-only today. */
export function awarenessAll(): Map<TerminalId, AwarenessValue> {
  return new Map(awareness);
}

/** Write a terminal's observation into the store — the single store mutator. In
 *  production the surface collection's `upsert` dep (below) routes here, so a
 *  `workspaceSurfaceCtx.collections.awareness.upsert` lands here AND pushes to
 *  subscribers; unit tests call it directly to seed an observation without the
 *  full surface wired. */
export function setAwareness(id: TerminalId, value: AwarenessValue): void {
  awareness.set(id, value);
}

/** Drop a terminal's observation — on exit / kill / sleep (the sensors stop, so
 *  the live value is gone; a slept terminal's last values freeze onto its record).
 *  Mirrors how `arivu` removes a departed terminal from its served collection. */
export function forgetAwareness(id: TerminalId): void {
  awareness.delete(id);
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
      // The observation store IS this collection's backing: `readAll`/`readOne`
      // read the map; `upsert`/`remove` write it AND (through the ctx) push to
      // subscribers. The sensor sink is the sole writer (via
      // `workspaceSurfaceCtx.collections.awareness.upsert`).
      awareness: {
        readAll: awarenessAll,
        readOne: (key) => awarenessFor(key as TerminalId),
        upsert: (key, value) => setAwareness(key as TerminalId, value),
        remove: (key) => forgetAwareness(key as TerminalId),
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
