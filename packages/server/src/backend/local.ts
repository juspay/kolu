/**
 * LocalBackend — the `Backend` implementation for the local machine.
 *
 * Owns the PTY lifecycle, every per-terminal provider that watches the
 * local filesystem (git, github, foreground process, agent reconcilers),
 * and the local one-shot fs/git ops the Code tab consumes. The kolu
 * server's `terminals.ts` / `router.ts` no longer reach into
 * `kolu-git` / `kolu-anyagent` / `kolu-pty` directly for terminal-scoped
 * work — every per-terminal entry point goes through this class. The
 * `meta/*` orchestrators stay where they sit in `../meta/`, but the only
 * caller is this file; from outside the backend they are invisible.
 *
 * R-2 will add `RemoteBackend(connection)` that satisfies the same
 * interface by proxying every op via oRPC over `ssh stdio` to a
 * `kolu agent --stdio` peer.
 */

import { ORPCError } from "@orpc/server";
import type {
  Backend,
  BackendFs,
  BackendGit,
  PtySpawnOpts,
  TerminalChannelMap,
  TerminalHandle,
} from "kolu-common/backend";
import type { TerminalLocation } from "kolu-common/surface";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import {
  type GitResult,
  getDiff,
  getStatus,
  listAll,
  readFile,
} from "kolu-git";
import { spawnPty } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import { koluShellDir } from "../koluRoot.ts";
import { log } from "../log.ts";
import {
  createMetadata,
  startProviders,
  updateServerMetadata,
} from "../meta/index.ts";
import { terminalChannels } from "../publisher.ts";
import {
  getTerminal,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";

/** Throw an `ORPCError` if a `GitResult` is `err`; otherwise return the
 *  value. The router used to do this — moved here so the kolu-git error
 *  taxonomy is bound at the backend boundary, not at the wire. */
function unwrap<T>(result: GitResult<T>): T {
  if (result.ok) return result.value;
  switch (result.error.code) {
    case "NOT_A_REPO":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "Not a git repository",
      });
    case "GIT_FAILED":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: result.error.message,
      });
    case "PATH_ESCAPES_ROOT":
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `path escapes root: ${result.error.child}`,
      });
    default:
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: String(result.error),
      });
  }
}

export class LocalBackend implements Backend {
  readonly id: TerminalLocation = { kind: "local" };

  /**
   * Spawn a new terminal on this backend.
   *
   * Pipeline:
   *  1. Spawn the PTY with `kolu-pty` and wire its OSC callbacks to the
   *     in-process `terminalChannels.*` publishers.
   *  2. Create metadata (`createMetadata`), seed client-owned fields
   *     from `opts.initialMetadata` BEFORE starting providers so the
   *     first `terminalMetadata` collection yield carries them (#642).
   *  3. Register the entry in the shared `terminal-registry`.
   *  4. Start the meta/* provider DAG (`startProviders`).
   *  5. Return a `TerminalHandle` whose `dispose()` calls back into
   *     `killTerminal(id)` — kill-convergence invariant.
   */
  async spawnPty(opts: PtySpawnOpts): Promise<TerminalHandle> {
    const id = crypto.randomUUID();
    const tlog = log.child({ terminal: id });

    const handle = spawnPty(
      tlog,
      id,
      {
        rcDir: koluShellDir,
        termProgramVersion: pkg.version,
        scrollback: DEFAULT_SCROLLBACK,
        onData: (data) => terminalChannels.data(id).publish(data),
        onExit: (exitCode) => {
          tlog.info({ exitCode }, "exited");
          // `wasNatural` is decided by whether the entry was still in
          // the registry at the moment the PTY exited. Explicit kills
          // (`killTerminal` here, or `killAllTerminals` via the
          // drain-before-dispose ordering) unregister first, so this
          // callback sees `wasNatural=false` and the caller knows to
          // skip the session-save fanout (which they already did at
          // explicit-kill time, or are intentionally skipping during
          // shutdown).
          const wasNatural = getTerminal(id) !== undefined;
          if (wasNatural) {
            const entry = getTerminal(id);
            if (entry) {
              entry.stopProviders();
              cleanupTerminalScratch(id);
              unregisterTerminal(id);
            }
          }
          opts.onExit?.(exitCode, wasNatural);
        },
        onTitleChange: (title) => terminalChannels.title(id).publish(title),
        onCommandRun: (raw) => terminalChannels.commandRun(id).publish(raw),
        onCwd: (newCwd) => {
          const entry = getTerminal(id);
          if (entry) {
            updateServerMetadata(entry, id, (m) => {
              m.cwd = newCwd;
            });
            terminalChannels.cwd(id).publish(newCwd);
          }
        },
      },
      opts.cwd,
    );

    const meta = createMetadata(handle.cwd, this.id);
    // Seed client-owned initial metadata BEFORE startProviders so the first
    // `terminalMetadata` collection yield carries these fields (see #642).
    // `createMetadata` is the source of truth for which fields exist;
    // `Object.assign` only writes the ones the caller supplied.
    if (opts.initialMetadata) Object.assign(meta, opts.initialMetadata);

    const entry: TerminalProcess = {
      info: { id },
      meta,
      handle,
      stopProviders: () => {},
    };
    // Register BEFORE starting providers (providers may emit immediately).
    registerTerminal(id, entry);
    entry.stopProviders = startProviders(entry, id);

    tlog.info({ pid: handle.pid }, "created");

    return {
      id,
      write: (data) => handle.write(data),
      resize: (cols, rows) => handle.resize(cols, rows),
      // Kill-convergence: dispose() is observationally identical to
      // backend.killTerminal(id). Both end at the same teardown path
      // (`killTerminal` below).
      dispose: () => {
        this.killTerminal(id);
      },
    };
  }

  terminalChannel<K extends keyof TerminalChannelMap>(
    terminalId: string,
    kind: K,
    signal?: AbortSignal,
  ): AsyncIterable<TerminalChannelMap[K]> {
    // The publisher's typed channels already enforce a per-kind payload
    // type; cast back to the public Backend shape (which the interface
    // narrows per K).
    return terminalChannels[kind](terminalId).subscribe(
      signal,
    ) as AsyncIterable<TerminalChannelMap[K]>;
  }

  killTerminal(terminalId: string): boolean {
    const entry = getTerminal(terminalId);
    if (!entry) return false;
    log
      .child({ terminal: terminalId })
      .info({ pid: entry.handle.pid }, "killing");
    // Order matters: stop providers and unregister BEFORE disposing the
    // PTY. The PTY's `onExit` callback (above) checks `getTerminal(id)`
    // to decide `wasNatural`; if we disposed first, it could race and
    // mis-classify this kill as natural.
    unregisterTerminal(terminalId);
    this.killTerminalEntry(entry);
    return true;
  }

  killTerminalEntry(entry: {
    info: { id: string };
    handle: { dispose(): void };
    stopProviders: () => void;
  }): void {
    entry.stopProviders();
    cleanupTerminalScratch(entry.info.id);
    entry.handle.dispose();
  }

  fs: BackendFs = {
    listAll: async (path) => unwrap(await listAll(path, log)),
    readFile: async (repoPath, filePath) =>
      unwrap(await readFile(repoPath, filePath, log)),
  };

  git: BackendGit = {
    getDiff: async (repoPath, filePath, mode, oldPath) =>
      unwrap(await getDiff(repoPath, filePath, mode, log, oldPath)),
    getStatus: async (repoPath, mode) =>
      unwrap(await getStatus(repoPath, mode, log)),
  };
}

/** Singleton — the kolu server's one local backend. R-2 adds a
 *  per-host `RemoteBackend` registry; this stays the local instance. */
export const localBackend = new LocalBackend();
