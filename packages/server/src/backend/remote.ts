/**
 * RemoteBackend — the `Backend` implementation for terminals living on
 * a remote SSH host. Proxies every method via oRPC over `ssh stdio` to
 * a `kolu agent --stdio` peer (see `agentContract` in kolu-common).
 *
 * One RemoteBackend per host; the `getBackendForCreate` resolver in
 * `./index.ts` caches them. RemoteBackend doesn't own the connection
 * itself — that's `HostSession` (transport + state machine). Two
 * axes, two modules. The connection survives multiple terminals on
 * the same host.
 *
 * **STREAM_RETRY** (`.claude/rules/streaming.md`): oRPC's
 * `ClientRetryPlugin` handles reconnect transparently — when the ssh
 * stdio pipe drops, the plugin re-invokes each open stream and the
 * snapshot-then-delta first yield re-syncs client state. No bespoke
 * reconnect logic needed in this file; HostSession's state machine
 * only governs *whether* to try reconnecting.
 */

import type {
  Backend,
  BackendFs,
  BackendGit,
  PtySpawnOpts,
  TerminalChannelMap,
  TerminalHandle,
} from "kolu-common/backend";
import type { TerminalLocation } from "kolu-common/surface";
import { log } from "../log.ts";
import {
  getTerminal,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import type { AgentClient, HostSession } from "./host-session.ts";
import { remoteHandle } from "./remote-handle.ts";

/** Lazily resolve the agent client — throws a typed error if the
 *  session isn't connected yet. Each method body uses this to surface
 *  a clear failure rather than a `Cannot read properties of undefined`. */
function clientOf(session: HostSession): AgentClient {
  if (!session.client) {
    throw new Error(
      `RemoteBackend(${session.host}): not connected. Call installSshAgent / HostSession.connect first.`,
    );
  }
  return session.client;
}

export class RemoteBackend implements Backend {
  readonly id: TerminalLocation;

  constructor(private readonly session: HostSession) {
    this.id = { kind: "ssh", host: session.host };
  }

  async spawnPty(opts: PtySpawnOpts): Promise<TerminalHandle> {
    log.info({ host: this.session.host }, "RemoteBackend.spawnPty");
    // Lazy connect — multiple concurrent spawn requests on a fresh
    // session all await one `connect()`; subsequent calls are no-ops.
    await this.session.connect();
    const { id } = await clientOf(this.session).terminal.spawn({
      cwd: opts.cwd,
      initialMetadata: opts.initialMetadata,
    });
    this.session.registerTerminal(id);

    // Register a shadow entry in the kolu server's terminal-registry so
    // router-level operations (`terminal.attach`, `sendInput`, `resize`,
    // `kill`, `screenState`) find the terminal. `handle` is a PtyHandle-
    // shaped proxy that forwards via session.client.
    const handle = remoteHandle({
      id,
      cwd: opts.cwd ?? "/",
      session: this.session,
    });
    const metaMod = await import("../meta/index.ts");
    const meta = metaMod.createMetadata(opts.cwd ?? "/", this.id);
    if (opts.initialMetadata) Object.assign(meta, opts.initialMetadata);
    meta.connectionState = this.session.connectionState();
    const entry: TerminalProcess = {
      info: { id },
      meta,
      handle,
      stopProviders: () => {},
    };
    // Register BEFORE subscribing — onStateChange fires the listener
    // synchronously with the current state (snapshot-then-delta), and
    // the listener's `getTerminal(id)` lookup must succeed for the
    // initial metadata publish to flow.
    registerTerminal(id, entry);
    entry.stopProviders = this.session.onStateChange((s) => {
      const e = getTerminal(id);
      if (e) {
        metaMod.updateServerLiveMetadata(e, id, (m) => {
          m.connectionState = s;
        });
      }
    });

    return {
      id,
      write: (data) => handle.write(data),
      resize: (cols, rows) => handle.resize(cols, rows),
    };
  }

  terminalChannel<K extends keyof TerminalChannelMap>(
    terminalId: string,
    kind: K,
    _signal?: AbortSignal,
  ): AsyncIterable<TerminalChannelMap[K]> {
    // `connectionState` is in-process — the kolu server's view of the
    // session's state, not something to fetch from the agent.
    if (kind === "connectionState") {
      const session = this.session;
      return {
        async *[Symbol.asyncIterator]() {
          let resolve: ((v: TerminalChannelMap[K]) => void) | null = null;
          const queue: TerminalChannelMap[K][] = [];
          const stop = session.onStateChange((s) => {
            if (resolve) {
              const r = resolve;
              resolve = null;
              r(s as TerminalChannelMap[K]);
            } else {
              queue.push(s as TerminalChannelMap[K]);
            }
          });
          try {
            while (true) {
              if (queue.length > 0) {
                const v = queue.shift();
                if (v !== undefined) yield v;
              } else {
                yield await new Promise<TerminalChannelMap[K]>((r) => {
                  resolve = r;
                });
              }
            }
          } finally {
            stop();
          }
        },
      };
    }
    // Per-kind dispatch — one named procedure per TerminalChannelMap key.
    // The client's stream procedures return `Promise<AsyncIterable<T>>`;
    // wrap so the caller sees a direct `AsyncIterable<T>`.
    const client = clientOf(this.session);
    const callFor = (k: Exclude<K, "connectionState">) => {
      switch (k) {
        case "data":
          return client.terminal.channelData({ id: terminalId });
        case "cwd":
          return client.terminal.channelCwd({ id: terminalId });
        case "title":
          return client.terminal.channelTitle({ id: terminalId });
        case "git":
          return client.terminal.channelGit({ id: terminalId });
        case "commandRun":
          return client.terminal.channelCommandRun({ id: terminalId });
        case "agent":
          return client.terminal.channelAgent({ id: terminalId });
        case "pr":
          return client.terminal.channelPr({ id: terminalId });
        case "foreground":
          return client.terminal.channelForeground({ id: terminalId });
      }
    };
    if (kind === "connectionState") throw new Error("unreachable");
    const promise = callFor(kind as Exclude<K, "connectionState">);
    return {
      async *[Symbol.asyncIterator]() {
        const it = await promise;
        for await (const v of it) yield v as TerminalChannelMap[K];
      },
    };
  }

  killTerminal(terminalId: string): boolean {
    void clientOf(this.session)
      .terminal.kill({ id: terminalId })
      .catch((err) => {
        log.warn(
          { host: this.session.host, terminalId, err },
          "remote kill failed",
        );
      });
    this.session.unregisterTerminal(terminalId);
    // Remove the server-side shadow entry too.
    unregisterTerminal(terminalId);
    return true;
  }

  killTerminalEntry(entry: {
    info: { id: string };
    handle: { dispose(): void };
    stopProviders: () => void;
  }): void {
    entry.stopProviders();
    this.killTerminal(entry.info.id);
  }

  async uploadFile(
    terminalId: string,
    name: string,
    base64Data: string,
  ): Promise<string> {
    const { path } = await clientOf(this.session).terminal.uploadFile({
      id: terminalId,
      name,
      base64Data,
    });
    return path;
  }

  fs: BackendFs = {
    listAll: async (repoPath) => {
      const { paths } = await clientOf(this.session).fs.listAll({ repoPath });
      return paths;
    },
    readFile: async (repoPath, filePath) => {
      const out = await clientOf(this.session).fs.readFile({
        repoPath,
        filePath,
      });
      // FsReadFileOutput is a discriminated union (text | binary).
      // RemoteBackend's caller (router.ts) expects {content, truncated}
      // for text reads; binary reads would need different plumbing
      // (URL handle) that R-2 doesn't carry over the wire yet.
      if ("content" in out) {
        return { content: out.content, truncated: out.truncated };
      }
      return { content: "", truncated: false };
    },
    subscribeRepoChange: (repoPath, _signal) => {
      const promise = clientOf(this.session).fs.subscribeRepoChange({
        repoPath,
      });
      return {
        async *[Symbol.asyncIterator]() {
          const it = await promise;
          for await (const _ of it) yield;
        },
      };
    },
    subscribeFileChange: (repoPath, filePath, _signal) => {
      const promise = clientOf(this.session).fs.subscribeFileChange({
        repoPath,
        filePath,
      });
      return {
        async *[Symbol.asyncIterator]() {
          const it = await promise;
          for await (const _ of it) yield;
        },
      };
    },
  };

  git: BackendGit = {
    getDiff: async (repoPath, filePath, mode, oldPath) =>
      clientOf(this.session).git.getDiff({
        repoPath,
        filePath,
        mode,
        oldPath,
      }),
    getStatus: async (repoPath, mode) =>
      clientOf(this.session).git.getStatus({ repoPath, mode }),
  };
}
