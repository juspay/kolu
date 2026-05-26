/**
 * LocalBackend — the `Backend` implementation for the local machine.
 *
 * Owns the PTY lifecycle, every per-terminal provider that watches the
 * local filesystem (git, github, foreground process, agent reconcilers),
 * and the local fs/git ops the Code tab consumes (one-shot and
 * subscription forms). The kolu server's `terminals.ts` / `router.ts`
 * no longer reach into `kolu-git` / `kolu-anyagent` / `kolu-pty`
 * directly for terminal-scoped work — every per-terminal entry point
 * goes through this class.
 *
 * R-2 expansions over R-1:
 *  - Publishes to the new `agent` / `pr` / `foreground` /
 *    `connectionState` channels so `RemoteBackend` (or the kolu server
 *    when it consumes channels uniformly) sees the same data stream
 *    the in-process providers produce.
 *  - Implements `BackendFs`/`BackendGit` subscription methods — wraps
 *    `kolu-git`'s callback-based watchers in async generators so the
 *    interface shape carries over to `RemoteBackend` (where the
 *    subscriptions flow over oRPC streams).
 *  - Implements `Backend.uploadFile` — wraps the existing
 *    `saveTerminalFile` (server's local scratch). `RemoteBackend`'s
 *    `uploadFile` will RPC to the agent so paste/upload targets the
 *    agent's filesystem, not the kolu-server's.
 *
 * The agent-detection providers (`claude-code`, `codex`, `opencode`,
 * `github` PR poll, foreground process) currently run inside this
 * class via `startProviders` — they read PIDs from the local PtyHandle.
 * In a full R-2 world, the agent host's `LocalBackend` runs these and
 * publishes to channels; the kolu server's `RemoteBackend` subscribes.
 * The prototype keeps the providers running server-side for local
 * tiles; the channel publishes below are the seam that R-3 will
 * complete by routing remote terminals' provider output through them.
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
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { TerminalLocation } from "kolu-common/surface";
import {
  type GitResult,
  getDiff,
  getStatus,
  listAll,
  readFile,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import { spawnPty } from "kolu-pty";
import pkg from "../../package.json" with { type: "json" };
import { koluShellDir } from "../koluRoot.ts";
import { log } from "../log.ts";
import {
  createMetadata,
  startProviders,
  updateServerMetadata,
} from "../meta/index.ts";
import { terminalChannels } from "../publisher.ts";
import { saveTerminalFile } from "../terminalScratch.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import {
  getTerminal,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";

/** Shared `GitResult` unwrap → `ORPCError` mapping. Both backends import
 *  this so the kolu-git error taxonomy is bound once at the backend
 *  boundary. R-2 finding M. */
export function unwrapBackendGit<T>(result: GitResult<T>): T {
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

/** Wrap a callback-based watcher (the shape `kolu-git`'s subscribe
 *  functions expose) as an `AsyncIterable<void>` for `Backend.fs/git`
 *  consumers. First yield is the initial "subscription armed" tick;
 *  subsequent yields fire on each watcher event. */
function watcherToAsyncIterable(
  install: (cb: () => void) => () => void,
  signal?: AbortSignal,
): AsyncIterable<void> {
  return {
    async *[Symbol.asyncIterator]() {
      const queue: Array<void> = [];
      let resolveNext: ((v: void) => void) | null = null;
      const stop = install(() => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r();
        } else queue.push(undefined);
      });
      const onAbort = () => {
        stop();
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r();
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        // Initial snapshot tick.
        yield;
        while (!signal?.aborted) {
          if (queue.length > 0) {
            queue.shift();
            yield;
          } else {
            await new Promise<void>((r) => {
              resolveNext = r;
            });
          }
        }
      } finally {
        stop();
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export class LocalBackend implements Backend {
  readonly id: TerminalLocation = { kind: "local" };

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
          const entry = getTerminal(id);
          const wasNatural = entry !== undefined;
          if (entry) {
            entry.stopProviders();
            cleanupTerminalScratch(id);
            unregisterTerminal(id);
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
    if (opts.initialMetadata) Object.assign(meta, opts.initialMetadata);

    const entry: TerminalProcess = {
      info: { id },
      meta,
      handle,
      stopProviders: () => {},
    };
    registerTerminal(id, entry);
    entry.stopProviders = startProviders(entry, id);

    tlog.info({ pid: handle.pid }, "created");

    // Connection state is `"live"` from spawn for local terminals;
    // publish once so any subscriber sees the initial snapshot.
    // RemoteBackend's HostSession drives this from its state machine.
    terminalChannels.connectionState(id).publish("live");

    return {
      id,
      write: (data) => handle.write(data),
      resize: (cols, rows) => handle.resize(cols, rows),
    };
  }

  terminalChannel<K extends keyof TerminalChannelMap>(
    terminalId: string,
    kind: K,
    signal?: AbortSignal,
  ): AsyncIterable<TerminalChannelMap[K]> {
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

  async uploadFile(
    terminalId: string,
    name: string,
    base64Data: string,
  ): Promise<string> {
    // Local-side scratch dir (per-terminal). `RemoteBackend.uploadFile`
    // will RPC to the agent so the file lands on the agent's
    // filesystem.
    return saveTerminalFile(terminalId, name, base64Data);
  }

  fs: BackendFs = {
    listAll: async (path) => unwrapBackendGit(await listAll(path, log)),
    readFile: async (repoPath, filePath) =>
      unwrapBackendGit(await readFile(repoPath, filePath, log)),
    subscribeRepoChange: (repoPath, signal) =>
      watcherToAsyncIterable(
        (cb) => subscribeRepoChange(repoPath, cb, log),
        signal,
      ),
    subscribeFileChange: (repoPath, filePath, signal) =>
      watcherToAsyncIterable(
        (cb) => subscribeFileChange(repoPath, filePath, cb, log),
        signal,
      ),
  };

  git: BackendGit = {
    getDiff: async (repoPath, filePath, mode, oldPath) =>
      unwrapBackendGit(await getDiff(repoPath, filePath, mode, log, oldPath)),
    getStatus: async (repoPath, mode) =>
      unwrapBackendGit(await getStatus(repoPath, mode, log)),
    subscribeRepoChange: (repoPath, signal) =>
      watcherToAsyncIterable(
        (cb) => subscribeRepoChange(repoPath, cb, log),
        signal,
      ),
  };
}

export const localBackend = new LocalBackend();
