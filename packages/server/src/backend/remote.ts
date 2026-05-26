/**
 * RemoteBackend — the `Backend` implementation for terminals living on
 * a remote SSH host. Proxies every method via oRPC over `ssh stdio` to
 * a `kolu agent --stdio` peer (see `agentSurface` in kolu-common —
 * Surface formulation of the agent's typed reactive surface).
 *
 * One RemoteBackend per host; the `getBackendForCreate` resolver in
 * `./index.ts` caches them. RemoteBackend doesn't own the connection
 * itself — that's `HostSession` (transport + state machine). Two
 * axes, two modules. The connection survives multiple terminals on
 * the same host.
 *
 * Phase 2 (Surface subsumption) migration: this file now consumes
 * `agentSurface` via `HostSession.surfaceClient` instead of the
 * hand-rolled `agentContract` client. The 9-channel per-terminal
 * mirroring loop collapses to ONE subscription on the
 * `terminalMetadata` collection — the agent's side aggregates
 * (`agent-surface.ts:startAgentMetadataAggregator`) and the
 * kolu-server applies updates to `entry.meta` in one place.
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
import type { AgentTerminalMetadata } from "kolu-common/agentSurface";
import type { TerminalLocation } from "kolu-common/surface";
import { log } from "../log.ts";
import {
  getTerminal,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import type { AgentSurfaceClient, HostSession } from "./host-session.ts";
import { remoteHandle } from "./remote-handle.ts";

/** Lazily resolve the agent surface client — throws a typed error if
 *  the session isn't connected yet. Each method body uses this to
 *  surface a clear failure rather than a `Cannot read properties of
 *  undefined`. */
function surfaceClientOf(session: HostSession): AgentSurfaceClient {
  if (!session.surfaceClient) {
    throw new Error(
      `RemoteBackend(${session.host}): not connected. Call installSshAgent / HostSession.connect first.`,
    );
  }
  return session.surfaceClient;
}

/** Apply an agent-published metadata snapshot to the kolu-server-side
 *  `entry.meta`. The agent only ships fields it manages
 *  (`AgentTerminalMetadata`); the kolu-server holds the remaining
 *  client-managed fields (themeName, canvasLayout, etc.) untouched. */
function applyAgentMetadata(
  metaMod: typeof import("../meta/index.ts"),
  id: string,
  snapshot: AgentTerminalMetadata,
): void {
  const entry = getTerminal(id);
  if (!entry) return;
  // Server-persisted fields (cwd, git, lastAgentCommand, lastActivityAt)
  // go through `updateServerMetadata` which fires `terminals:dirty`
  // for the autosave loop.
  metaMod.updateServerMetadata(entry, id, (m) => {
    m.cwd = snapshot.cwd;
    m.git = snapshot.git;
    m.lastAgentCommand = snapshot.lastAgentCommand;
    m.lastActivityAt = snapshot.lastActivityAt;
  });
  // Live transient fields (agent, pr, foreground) go through
  // `updateServerLiveMetadata` which does NOT fire `terminals:dirty`.
  metaMod.updateServerLiveMetadata(entry, id, (m) => {
    m.agent = snapshot.agent;
    m.pr = snapshot.pr;
    m.foreground = snapshot.foreground;
  });
}

export class RemoteBackend implements Backend {
  readonly id: TerminalLocation;

  constructor(private readonly session: HostSession) {
    this.id = { kind: "ssh", host: session.host };
  }

  async spawnPty(opts: PtySpawnOpts): Promise<TerminalHandle> {
    // Pre-generate the id so we can register a "connecting" shadow
    // entry on the kolu server BEFORE the agent's spawn RPC roundtrips.
    // Without this, the tile only appears after the (possibly minutes-
    // long) cold `nix run` realisation completes — invisible-progress
    // UX. The agent then honors the same id, keeping kolu-server <->
    // agent registries in lockstep.
    const id = opts.id ?? crypto.randomUUID();
    log.info({ host: this.session.host, id }, "RemoteBackend.spawnPty");

    const handle = remoteHandle({
      id,
      cwd: opts.cwd ?? "/",
      session: this.session,
    });
    const metaMod = await import("../meta/index.ts");
    const meta = metaMod.createMetadata(opts.cwd ?? "/", this.id);
    if (opts.initialMetadata) Object.assign(meta, opts.initialMetadata);
    // Tile renders "Connecting…" overlay from this state.
    meta.connectionState = "connecting";
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
    this.session.registerTerminal(id);

    // State-listener subscriber starts immediately — it doesn't need
    // session.client. The metadata subscriber (which DOES need a live
    // client) starts after `terminal.spawn` returns.
    const stopState = this.startStateSubscriber(id, metaMod);
    entry.stopProviders = stopState;

    // Async tail — connect the session, RPC-spawn on the agent, then
    // wire up the metadata subscriber. Errors surface via the entry's
    // connectionState transitioning to "disconnected" (HostSession's
    // subprocess-exit handler), which is what the DisconnectedOverlay
    // renders.
    void (async () => {
      try {
        await this.session.connect();
        await surfaceClientOf(this.session).surface.terminal.spawn({
          id,
          cwd: opts.cwd,
          initialMetadata: opts.initialMetadata,
        });
        // First successful RPC roundtrip — the agent is alive. Mark
        // ready so HostSession's heartbeat loop starts (deliberately
        // deferred to avoid timing out the cold `nix run` realisation).
        this.session.markReady();
        // Now that the client is live, attach the metadata subscriber
        // (collapses Phase 1's 3 separate channel-mirror loops into
        // one subscription on the terminalMetadata collection) and
        // compose its stop fn with the state-listener stop. If the
        // entry was killed between subscribe and now, the subscriber
        // self-terminates when getTerminal(id) returns undefined.
        const stopMetadata = this.startMetadataSubscriber(id, metaMod);
        const stopStateRef = entry.stopProviders;
        entry.stopProviders = () => {
          stopStateRef();
          stopMetadata();
        };
      } catch (err) {
        log.error(
          { host: this.session.host, id, err },
          "RemoteBackend.spawnPty: async connect/spawn failed",
        );
      }
    })();

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

    const client = surfaceClientOf(this.session);

    // Streams that have direct surface counterparts: data, commandRun,
    // title. PTY bytes and raw OSC stream sources.
    if (kind === "data" || kind === "commandRun" || kind === "title") {
      const streamPromise =
        kind === "data"
          ? client.surface.terminalData.get({ id: terminalId })
          : kind === "commandRun"
            ? client.surface.terminalCommandRun.get({ id: terminalId })
            : client.surface.terminalTitle.get({ id: terminalId });
      return {
        async *[Symbol.asyncIterator]() {
          const it = await streamPromise;
          for await (const v of it) yield v as TerminalChannelMap[K];
        },
      };
    }

    // Remaining channels (cwd, git, agent, pr, foreground) all live
    // inside the aggregated `terminalMetadata` collection. Derive each
    // by subscribing once and projecting per-snapshot. The key names
    // on `AgentTerminalMetadata` match the `TerminalChannelMap` kinds
    // exactly — no switch needed.
    return {
      async *[Symbol.asyncIterator]() {
        const it = await client.surface.terminalMetadata.get({
          key: terminalId,
        });
        const field = kind as keyof AgentTerminalMetadata &
          keyof TerminalChannelMap;
        for await (const snapshot of it) {
          yield snapshot[field] as TerminalChannelMap[K];
        }
      },
    };
  }

  /** Connection-state subscriber — pure in-process listener on
   *  HostSession state changes, no `session.client` needed. Starts
   *  immediately so the tile reflects "connecting" / "live" /
   *  "disconnected" transitions even before the agent boots. */
  private startStateSubscriber(
    id: string,
    metaMod: typeof import("../meta/index.ts"),
  ): () => void {
    return this.session.onStateChange((s) => {
      const e = getTerminal(id);
      if (e) {
        metaMod.updateServerLiveMetadata(e, id, (m) => {
          m.connectionState = s;
        });
      }
    });
  }

  /** Subscribe to the agent's `terminalMetadata` collection for this
   *  id and mirror each snapshot to `entry.meta` on the kolu-server
   *  side. Replaces Phase 1's three separate `for await` loops over
   *  individual channels with one subscription that gets the
   *  aggregated `AgentTerminalMetadata` per-snapshot — the agent's
   *  `startAgentMetadataAggregator` does the aggregation.
   *
   *  CALL AFTER `session.connect()` HAS RETURNED — invokes
   *  `surfaceClientOf(this.session)` which throws if the client isn't
   *  built yet. Starting before connect dies on the first iteration
   *  and the subscriber never reattaches. */
  private startMetadataSubscriber(
    id: string,
    metaMod: typeof import("../meta/index.ts"),
  ): () => void {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const client = surfaceClientOf(this.session);
        const it = await client.surface.terminalMetadata.get({ key: id });
        for await (const snapshot of it) {
          if (ctrl.signal.aborted) break;
          applyAgentMetadata(metaMod, id, snapshot);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          log.warn(
            { host: this.session.host, id, err },
            "RemoteBackend: terminalMetadata subscriber failed",
          );
        }
      }
    })();
    return () => {
      ctrl.abort();
    };
  }

  killTerminal(terminalId: string): boolean {
    void surfaceClientOf(this.session)
      .surface.terminal.kill({ id: terminalId })
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
    const { path } = await surfaceClientOf(
      this.session,
    ).surface.terminal.uploadFile({
      id: terminalId,
      name,
      base64Data,
    });
    return path;
  }

  fs: BackendFs = {
    listAll: async (repoPath) => {
      const { paths } = await surfaceClientOf(this.session).surface.fs.listAll({
        repoPath,
      });
      return paths;
    },
    readFile: async (repoPath, filePath) => {
      const out = await surfaceClientOf(this.session).surface.fs.readFile({
        repoPath,
        filePath,
      });
      // FsReadFileOutput is a discriminated union (text | binary).
      // RemoteBackend's caller (router.ts) expects {content, truncated}
      // for text reads; binary reads would need different plumbing
      // (URL handle) that this PR doesn't carry over the wire yet.
      if ("content" in out) {
        return { content: out.content, truncated: out.truncated };
      }
      return { content: "", truncated: false };
    },
    subscribeRepoChange: (repoPath, _signal) => {
      const promise = surfaceClientOf(this.session).surface.fsRepoChange.get({
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
      const promise = surfaceClientOf(this.session).surface.fsFileChange.get({
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
      surfaceClientOf(this.session).surface.git.getDiff({
        repoPath,
        filePath,
        mode,
        oldPath,
      }),
    getStatus: async (repoPath, mode) =>
      surfaceClientOf(this.session).surface.git.getStatus({ repoPath, mode }),
  };
}
