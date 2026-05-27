/**
 * `RemoteTerminalBackend` — proxies every `TerminalBackend` method to a
 * `kolu --stdio` agent running on an ssh-config host. One backend
 * instance per host; the underlying `HostSession` is shared (refcounted
 * by `pin()`) across all terminals on that host.
 *
 * Architecture:
 *
 *   - **PTY lifecycle**: `terminal.{spawn,kill,write,resize}` RPCs to
 *     the agent. `spawnPty` registers synchronously (placeholder
 *     pid=0); async tail pins the session, calls agent's spawn, and
 *     updates pid + starts the four per-terminal stream pumps.
 *   - **Data streams**: agent's `terminalData/Cwd/Title/CommandRun`
 *     streams are pumped into the parent's existing `terminalChannels`
 *     bus, so the kolu-server's `terminal.attach` and the agent
 *     detectors / providers running on the AGENT consume them
 *     identically to local terminals.
 *   - **Provider DAG runs on the agent** (see
 *     `./providers.ts`+`agent.ts`) — git watcher, github PR, claude/
 *     codex/opencode detectors, foreground-process observer all read
 *     state on the same machine the PTY lives on. The parent's
 *     `mirrorRemoteCollection` bridges agent-side `terminalMetadata`
 *     into the parent's own `terminalMetadata` collection.
 *   - **`getScreenState` / `getScreenText`**: a parent-side mirrored
 *     `@xterm/headless` terminal is fed by the data pump, so reconnect
 *     after a WebSocket drop reads the buffered scrollback locally
 *     instead of round-tripping another RPC.
 *   - **`fs` / `git`**: forwarded to the agent procedures.
 *   - **Heartbeat layer** detects stuck-agent cases (`./heartbeat.ts`).
 *   - **`HostSession.onState`** transitions feed
 *     `meta.connectionState` for the `<DisconnectedOverlay>`.
 */

import { createRequire } from "node:module";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { SerializeAddon as SerializeAddonType } from "@xterm/addon-serialize";
import {
  type AgentClient,
  mirrorRemoteCollection,
} from "@kolu/surface-nix-host";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { getScreenText } from "kolu-pty";

// `@xterm/headless` and `@xterm/addon-serialize` ship as CJS; their
// ESM named exports don't survive Node's default resolver. Match
// kolu-pty's load pattern (createRequire) so types come from the
// ambient `import type` declarations above.
const require_ = createRequire(import.meta.url);
const { Terminal } =
  require_("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require_(
    "@xterm/addon-serialize",
  ) as typeof import("@xterm/addon-serialize");
import type {
  AgentContract,
  AgentTerminalMetadata,
} from "kolu-common/agentSurface";
import type {
  PtySpawnOpts,
  TerminalBackend,
  TerminalBackendFs,
  TerminalBackendGit,
  TerminalChannelMap,
  TerminalHandle,
} from "kolu-common/terminalBackend";
import type {
  GitDiffMode,
  GitDiffOutput,
  GitStatusOutput,
  FsListAllOutput,
} from "kolu-git/schemas";
import type { TerminalId, TerminalInfo } from "kolu-common/surface";
import { log } from "../log.ts";
import { terminalChannels, terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surface.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  terminalEntries as terminalEntriesIter,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { startHeartbeat } from "./heartbeat.ts";
import {
  createMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";
import { getKoluHostSessionAsync } from "./remoteSession.ts";

/** Per-terminal record the backend keeps internally so the data-pump
 *  abort controllers (one per stream) can be torn down on kill. */
interface RemoteTerminalRecord {
  /** Aborts every per-terminal stream pump (data, cwd, title,
   *  commandRun). Used on kill / disconnect cleanup. */
  abort: AbortController;
}

class RemotePtyHandle implements TerminalHandle {
  pid = 0;
  /** Parent-side mirrored @xterm/headless instance fed by the agent's
   *  `terminalData` stream. On WebSocket reconnect the client re-
   *  attaches and calls `screenState` to fetch the buffered scrollback
   *  — which lives here instead of having to round-trip another RPC to
   *  the agent. Resize mirrors the agent so the headless buffer's
   *  geometry stays in sync. */
  readonly headless: HeadlessTerminal;
  private readonly serializeAddon: SerializeAddonType;

  constructor(
    private readonly host: string,
    private readonly id: TerminalId,
    private readonly backend: RemoteTerminalBackend,
    scrollback: number,
  ) {
    this.headless = new Terminal({
      cols: 80,
      rows: 24,
      scrollback,
      allowProposedApi: true,
    });
    this.serializeAddon = new SerializeAddon();
    this.headless.loadAddon(this.serializeAddon);
  }
  /** Feed a chunk from the agent's data stream into the mirrored
   *  buffer. Called by the data pump for each yielded chunk. */
  feed(data: string): void {
    this.headless.write(data);
  }
  write(data: string): void {
    void this.backend
      .callAgent((c) => c.surface.terminal.write({ id: this.id, data }))
      .catch((err) =>
        log.warn(
          { err, host: this.host, terminal: this.id },
          "remote write failed",
        ),
      );
  }
  resize(cols: number, rows: number): void {
    // Resize the local mirror first so screenshots between the
    // resize RPC firing and the agent's response stay coherent.
    this.headless.resize(cols, rows);
    void this.backend
      .callAgent((c) => c.surface.terminal.resize({ id: this.id, cols, rows }))
      .catch((err) =>
        log.warn(
          { err, host: this.host, terminal: this.id },
          "remote resize failed",
        ),
      );
  }
  getScreenState(): string {
    return this.serializeAddon.serialize();
  }
  getScreenText(startLine?: number, endLine?: number): string {
    return getScreenText(this.headless.buffer.active, startLine, endLine);
  }
  dispose(): void {
    this.headless.dispose();
  }
}

export class RemoteTerminalBackend implements TerminalBackend {
  readonly fs: TerminalBackendFs;
  readonly git: TerminalBackendGit;
  private readonly records = new Map<TerminalId, RemoteTerminalRecord>();

  constructor(private readonly host: string) {
    this.fs = buildRemoteFs(this);
    this.git = buildRemoteGit(this);
  }

  /** Cached pinned client. `HostSession.pin()` increments a refcount
   *  per call and the bridge code (parent-lifetime) is supposed to
   *  call it ONCE — calling on every RPC would grow refCount
   *  unboundedly and block the session's reconnect-on-disconnect
   *  teardown. Cache the resolved client once per backend; every
   *  subsequent RPC reuses it. */
  private clientPromise: Promise<AgentClient<AgentContract>> | null = null;
  private connectedAcked = false;
  private stateSubscribed = false;

  /** Run one RPC against the pinned client. Pin happens at most once
   *  per backend (per host). `markConnected()` runs at most once
   *  after the first successful RPC. */
  async callAgent<T>(
    fn: (client: AgentClient<AgentContract>) => Promise<T>,
  ): Promise<T> {
    if (!this.clientPromise) {
      this.clientPromise = getKoluHostSessionAsync(this.host).then((s) =>
        s.pin(),
      );
      // Subscribe to the session's connection-state changes once per
      // backend (per host). Every terminal on this host shares the
      // same underlying ssh subprocess, so they share the connection
      // state too — push the current state into each terminal's
      // `meta.connectionState` so the client's overlay can render.
      void this.ensureStateSubscription();
    }
    const client = await this.clientPromise;
    const result = await fn(client);
    if (!this.connectedAcked) {
      const session = await getKoluHostSessionAsync(this.host);
      session.markConnected();
      this.connectedAcked = true;
    }
    return result;
  }

  private async ensureStateSubscription(): Promise<void> {
    if (this.stateSubscribed) return;
    this.stateSubscribed = true;
    const session = await getKoluHostSessionAsync(this.host);
    session.onState((s) => {
      // Broadcast the new state to every terminal that lives on this
      // host. `onState` fires the current value synchronously on
      // subscribe (snapshot-then-delta), so the first call seeds the
      // connectionState for tiles that registered before the session
      // resolved.
      for (const [id, entry] of terminalEntriesIter()) {
        if (
          entry.meta.location?.kind === "remote" &&
          entry.meta.location.host === this.host
        ) {
          updateServerLiveMetadata(entry, id, (m) => {
            m.connectionState = s.connection;
          });
        }
      }
    });
    // App-level liveness probe — catches stuck-agent cases that the
    // transport can't see (ssh + agent process both alive, but agent
    // is deadlocked). On enough misses we destroy the session; the
    // next callAgent will re-acquire and the HostSession's reconnect
    // loop will respawn.
    startHeartbeat({
      session,
      onUnhealthy: () => {
        log.error(
          { host: this.host },
          "remote agent heartbeat exhausted — destroying session",
        );
        session.destroy();
        // Drop the cached client so the next callAgent re-pins.
        this.clientPromise = null;
        this.connectedAcked = false;
        this.stateSubscribed = false;
      },
    });
    // Bridge the agent's `terminalMetadata` collection into the
    // parent's. Every update on the agent side (spawn seed, cwd
    // change from OSC 7, and — once the provider DAG lives
    // agent-side — git/agent/pr/foreground events) flows here.
    void this.bridgeMetadata().catch((err) =>
      log.warn({ err, host: this.host }, "remote metadata mirror failed"),
    );
  }

  private async bridgeMetadata(): Promise<void> {
    const client = await this.callAgent(async (c) => c);
    await mirrorRemoteCollection<TerminalId, AgentTerminalMetadata>({
      label: `${this.host}/terminalMetadata`,
      log: (line) => log.warn({ host: this.host }, line),
      keys: client.surface.terminalMetadata.keys({}),
      get: (id, signal) =>
        client.surface.terminalMetadata.get({ key: id }, { signal }),
      onUpsert: (id, agentMeta) => {
        const entry = getTerminal(id);
        if (!entry) return;
        // The agent's `AgentTerminalMetadata` is the server-half of
        // the parent's `TerminalMetadata` (no themeName / canvasLayout /
        // subPanel / rightPanel / parentId / intent). Merge it in,
        // preserving the parent-only fields. Override `location` to
        // `{kind:"remote", host}` — the agent's view is always
        // "local" from its own perspective.
        updateServerLiveMetadata(entry, id, (m) => {
          // `m` is narrowed to LiveTerminalFields; merge the live
          // half explicitly. ServerPersistedTerminalFields (cwd,
          // git, lastAgentCommand, lastActivityAt) go through
          // `updateServerMetadata` — wrap separately to land them.
          m.pr = agentMeta.pr;
          m.agent = agentMeta.agent;
          m.foreground = agentMeta.foreground;
          // connectionState stays parent-side (mirrored from
          // session.onState above) — don't let the agent overwrite.
        });
        updateServerMetadata(entry, id, (m) => {
          m.cwd = agentMeta.cwd;
          m.git = agentMeta.git;
          m.lastAgentCommand = agentMeta.lastAgentCommand;
          if (agentMeta.lastActivityAt > 0)
            m.lastActivityAt = agentMeta.lastActivityAt;
          m.location = { kind: "remote", host: this.host };
        });
      },
      onRemove: (_id) => {
        // The kill flow already calls `surfaceCtx.collections.terminalMetadata.remove`
        // synchronously when the parent decides to kill, and the
        // registry is the source of truth for "does this terminal
        // still exist". Mirror-side remove notifications are
        // redundant.
      },
    });
  }

  /** Backend's host. Exposed for fs/git op pumps that need to obtain
   *  their own client (e.g. `subscribeRepoChange` runs an async loop
   *  that wants the same session this backend uses). */
  get hostName(): string {
    return this.host;
  }

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ host: this.host, terminal: id });
    tlog.info({ cwd: opts.cwd }, "remote spawn initiated");

    const handle = new RemotePtyHandle(this.host, id, this, DEFAULT_SCROLLBACK);
    const meta = createMetadata(opts.cwd ?? "", {
      kind: "remote",
      host: this.host,
    });
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.lastActivityAt !== undefined)
      meta.lastActivityAt = initial.lastActivityAt;
    if (initial?.intent) meta.intent = initial.intent;

    const entry: TerminalProcess = {
      info: { id, pid: 0 },
      meta,
      handle,
      location: { kind: "remote", host: this.host },
    };
    registerTerminal(id, entry);
    surfaceCtx.collections.terminalMetadata.upsert(id, { ...meta });
    surfaceCtx.cells.terminalList.set(listTerminals());
    terminalsDirtyChannel.publish({});

    const abort = new AbortController();
    this.records.set(id, { abort });

    void this.spawnAsync(id, opts, entry, handle, abort.signal).catch((err) => {
      tlog.error({ err }, "remote spawn failed — cleaning up local registry");
      // The tile rendered with pid=0 and writes were silently
      // dropping `remote write failed` warns. Tear the entry out
      // synchronously so the UI shows the failure instead of a
      // stuck "Connecting…" tile that the user has to manually kill.
      abort.abort();
      this.records.delete(id);
      unregisterTerminal(id);
      surfaceCtx.cells.terminalList.set(listTerminals());
      surfaceCtx.collections.terminalMetadata.remove(id);
      terminalsDirtyChannel.publish({});
    });

    return entry.info;
  }

  private async spawnAsync(
    id: TerminalId,
    opts: PtySpawnOpts,
    entry: TerminalProcess,
    handle: RemotePtyHandle,
    signal: AbortSignal,
  ): Promise<void> {
    const tlog = log.child({ host: this.host, terminal: id });
    const info = await this.callAgent((c) =>
      c.surface.terminal.spawn({
        id,
        cwd: opts.cwd,
        parentId: opts.parentId,
        initialMetadata: opts.initialMetadata,
      }),
    );
    handle.pid = info.pid;
    entry.info = { id, pid: info.pid };
    surfaceCtx.cells.terminalList.set(listTerminals());
    tlog.info({ pid: info.pid }, "remote spawn ready");

    // Fan out the agent's per-terminal streams into the kolu-server's
    // local per-terminal channels. Every consumer downstream
    // (`terminal.attach`, agent detectors if any wire up against
    // remote later) subscribes to the same `terminalChannels.X(id)`
    // bus regardless of backend. Stream clients expose `.get(input,
    // {signal})` per the surface framework's convention.
    const client = await this.callAgent(async (c) => c);
    void this.pumpStream(
      () => client.surface.terminalData.get({ id }, { signal }),
      id,
      "data",
      signal,
      // Feed the headless mirror in lockstep with publishing to the
      // local data channel so `screenState` reads have the same
      // bytes the client has rendered.
      (chunk) => handle.feed(chunk),
    );
    void this.pumpStream(
      () => client.surface.terminalCwd.get({ id }, { signal }),
      id,
      "cwd",
      signal,
    );
    void this.pumpStream(
      () => client.surface.terminalTitle.get({ id }, { signal }),
      id,
      "title",
      signal,
    );
    void this.pumpStream(
      () => client.surface.terminalCommandRun.get({ id }, { signal }),
      id,
      "commandRun",
      signal,
    );
  }

  private async pumpStream(
    open: () => Promise<AsyncIterable<unknown>>,
    id: TerminalId,
    channel: keyof TerminalChannelMap,
    signal: AbortSignal,
    /** Optional side-effect on each chunk (used by `data` to feed
     *  the parent-side mirrored headless terminal). */
    onChunk?: (value: string) => void,
  ): Promise<void> {
    try {
      const iter = await open();
      for await (const value of iter) {
        const v = value as string;
        onChunk?.(v);
        terminalChannels[channel](id).publish(v);
      }
    } catch (err) {
      if (!signal.aborted) {
        log.warn(
          { err, host: this.host, terminal: id, channel },
          "remote stream pump failed",
        );
      }
    }
  }

  killTerminal(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    const record = this.records.get(id);
    record?.abort.abort();
    this.records.delete(id);
    void this.callAgent((c) => c.surface.terminal.kill({ id })).catch((err) =>
      log.warn(
        { err, host: this.host, terminal: id },
        "remote kill RPC failed",
      ),
    );
    unregisterTerminal(id);
    surfaceCtx.cells.terminalList.set(listTerminals());
    surfaceCtx.collections.terminalMetadata.remove(id);
    terminalsDirtyChannel.publish({});
    return entry.info;
  }

  killAllTerminals(): void {
    const entries = drainTerminals();
    for (const r of this.records.values()) r.abort.abort();
    this.records.clear();
    for (const entry of entries) {
      void this.callAgent((c) =>
        c.surface.terminal.kill({ id: entry.info.id }),
      ).catch(() => {
        /* best effort */
      });
    }
    surfaceCtx.cells.terminalList.set(listTerminals());
  }

  subscribeTerminalChannel<K extends keyof TerminalChannelMap>(
    id: TerminalId,
    kind: K,
    signal: AbortSignal | undefined,
  ): AsyncIterable<TerminalChannelMap[K]> {
    // Same shape as local: subscribe to the in-process publisher; the
    // pumps in `spawnAsync` are what feed it from the agent.
    return terminalChannels[kind](id).subscribe(signal) as AsyncIterable<
      TerminalChannelMap[K]
    >;
  }
}

function buildRemoteFs(backend: RemoteTerminalBackend): TerminalBackendFs {
  return {
    async listAll(repoPath: string): Promise<FsListAllOutput> {
      return backend.callAgent((c) => c.surface.fs.listAll({ repoPath }));
    },
    async readFile(repoPath, filePath) {
      const { content, truncated } = await backend.callAgent((c) =>
        c.surface.fs.readFile({ repoPath, filePath }),
      );
      return { content, truncated };
    },
    async statFileMtimeMs(repoPath, filePath) {
      return backend.callAgent((c) =>
        c.surface.fs.statFileMtimeMs({ repoPath, filePath }),
      );
    },
    subscribeRepoChange(repoPath, onChange) {
      const ac = new AbortController();
      void (async () => {
        try {
          const session = await getKoluHostSessionAsync(backend.hostName);
          const client = await session.pin();
          const iter = await client.surface.fsRepoChange.get(
            { repoPath },
            { signal: ac.signal },
          );
          // First yield = subscription is alive = link is connected.
          // Mirrors the demo's pump-loop pattern.
          let first = true;
          for await (const _ of iter) {
            if (first) {
              session.markConnected();
              first = false;
            }
            onChange();
          }
        } catch (err) {
          if (!ac.signal.aborted)
            log.warn({ err, repoPath }, "remote repo-change pump failed");
        }
      })();
      return () => ac.abort();
    },
    subscribeFileChange(repoPath, filePath, onChange) {
      const ac = new AbortController();
      void (async () => {
        try {
          const session = await getKoluHostSessionAsync(backend.hostName);
          const client = await session.pin();
          const iter = await client.surface.fsFileChange.get(
            { repoPath, filePath },
            { signal: ac.signal },
          );
          let first = true;
          for await (const _ of iter) {
            if (first) {
              session.markConnected();
              first = false;
            }
            onChange();
          }
        } catch (err) {
          if (!ac.signal.aborted)
            log.warn(
              { err, repoPath, filePath },
              "remote file-change pump failed",
            );
        }
      })();
      return () => ac.abort();
    },
  };
}

function buildRemoteGit(backend: RemoteTerminalBackend): TerminalBackendGit {
  return {
    async getStatus(repoPath, mode: GitDiffMode): Promise<GitStatusOutput> {
      return backend.callAgent((c) =>
        c.surface.git.getStatus({ repoPath, mode }),
      );
    },
    async getDiff(repoPath, filePath, mode, oldPath): Promise<GitDiffOutput> {
      return backend.callAgent((c) =>
        c.surface.git.getDiff({ repoPath, filePath, mode, oldPath }),
      );
    },
  };
}
