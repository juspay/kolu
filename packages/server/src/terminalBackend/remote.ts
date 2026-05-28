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
  type HostSession,
  mirrorRemoteCollection,
} from "@kolu/surface-nix-host";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import { getScreenText } from "kolu-pty";

// `@xterm/headless` and `@xterm/addon-serialize` ship as CJS; their
// ESM named exports don't survive Node's default resolver. Match
// kolu-pty's load pattern (createRequire) so types come from the
// ambient `import type` declarations above.
const require_ = createRequire(import.meta.url);
const { Terminal } = require_(
  "@xterm/headless",
) as typeof import("@xterm/headless");
const { SerializeAddon } = require_(
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
 *  abort controllers (one per stream) can be torn down on kill, and the
 *  parent-side mirrored headless terminal can be disposed (releasing
 *  the scrollback buffer). */
interface RemoteTerminalRecord {
  /** Aborts every per-terminal stream pump (data, cwd, title,
   *  commandRun, exit). Used on kill / disconnect cleanup. */
  abort: AbortController;
  /** Parent-side mirrored xterm/headless. Must be disposed on
   *  kill/exit/spawn-failure or its internal buffer leaks. */
  handle: RemotePtyHandle;
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

  /** The pooled HostSession for this backend's host. Lazily resolved on
   *  first `callAgent` / `spawnPty` so the constructor stays
   *  synchronous (the dispatcher in `index.ts` builds the backend
   *  before any RPC fires). One `pin()` per backend bumps the refcount
   *  exactly once; reconnect-on-disconnect is driven by `runBridge`
   *  via `waitForNextClient`. */
  private session: HostSession<AgentContract> | null = null;
  private sessionPromise: Promise<HostSession<AgentContract>> | null = null;
  private bridgeStarted = false;
  private connectedAcked = false;

  /** Resolve the host session, kicking off the long-running bridge on
   *  first call. The bridge owns the `pin()` and the reconnect loop
   *  for host-level pumps (metadata mirror, heartbeat); per-terminal
   *  pumps in `spawnAsync` consume the *current* client at spawn time
   *  and bind to its lifetime — agent restart kills those terminals
   *  by construction (the agent has no memory of them after respawn).
   *
   *  Re-resolves if the cached session was destroyed (e.g. an explicit
   *  `destroyAllSessions()` on shutdown that the backend outlived).
   *  The pool guard in `getHostSession` would already hand back a fresh
   *  instance, but the cached field here bypasses the pool — without
   *  this guard the backend would stay glued to a dead session even
   *  though a fresh one was available. */
  private async ensureSession(): Promise<HostSession<AgentContract>> {
    if (this.session !== null && this.session.isDestroyed()) {
      this.session = null;
      this.sessionPromise = null;
      this.bridgeStarted = false;
      this.connectedAcked = false;
    }
    if (this.session) return this.session;
    if (!this.sessionPromise) {
      this.sessionPromise = getKoluHostSessionAsync(this.host).then((s) => {
        this.session = s;
        this.startBridge(s);
        return s;
      });
    }
    return this.sessionPromise;
  }

  /** Start the per-host bridge: state subscription, heartbeat,
   *  metadata-mirror reconnect loop. Runs once per backend. */
  private startBridge(session: HostSession<AgentContract>): void {
    if (this.bridgeStarted) return;
    this.bridgeStarted = true;

    // Pin once. The bridge loop drives reconnect; pin keeps refcount > 0
    // so the session doesn't tear itself down between disconnect and
    // reconnect.
    void session.pin().catch(() => {
      /* surfaced via session.onState; bridge loop handles recovery */
    });

    // Connection-state fanout. `onState` fires synchronously on
    // subscribe (snapshot-then-delta), so the initial value seeds
    // every remote-tile's `connectionState` overlay immediately.
    session.onState((s) => {
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

    // App-level liveness probe. The transport sees ssh death; this
    // catches stuck-agent cases (ssh + agent alive, agent deadlocked).
    // On exhaustion we `forceReconnect` rather than `destroy` — the
    // backend instance must survive heartbeat failures so a recoverable
    // stuck-agent doesn't permanently brick future spawns/RPCs.
    startHeartbeat({
      session,
      onUnhealthy: () => {
        log.error(
          { host: this.host },
          "remote agent heartbeat exhausted — forcing reconnect",
        );
        session.forceReconnect("heartbeat exhausted");
      },
    });

    void this.runMetadataMirror(session);
  }

  /** Reconnect loop for the per-host metadata mirror. On link drop
   *  (`mirrorRemoteCollection` returns when the keys stream ends),
   *  await the next client and remirror. The agent's mirror is fresh
   *  after each respawn — its terminal set is whatever the new agent
   *  has, not what the old one had. */
  private async runMetadataMirror(
    session: HostSession<AgentContract>,
  ): Promise<void> {
    while (!session.isDestroyed()) {
      // Wait for a live client (post-spawn) — `connection` state goes
      // copying → connecting → connected, but `markConnected` only
      // fires after a successful RPC, so gating on "connected" would
      // deadlock the bridge (mirror is the first RPC, by design).
      // Instead, wait for `currentClient()` to become non-null
      // (spawn finished). If the spawn fails we loop after the next
      // state transition.
      let client: AgentClient<AgentContract>;
      try {
        const cp = session.currentClient();
        if (!cp) {
          await waitForStateChange(session);
          continue;
        }
        client = await cp;
      } catch {
        await waitForStateChange(session);
        continue;
      }
      if (session.isDestroyed()) break;
      // Probe with a cheap RPC. If the link is alive, this returns
      // quickly and transitions the session to `connected`; if dead
      // (link already torn down), we wait for the next state change
      // before retrying. Without this probe, a half-broken link
      // (child alive, write EPIPE) would deadlock the mirror loop.
      try {
        await client.surface.system.heartbeat({});
        session.markConnected();
      } catch (err) {
        log.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            host: this.host,
          },
          "metadata mirror: probe failed, awaiting state change",
        );
        await waitForStateChange(session);
        continue;
      }
      await this.mirrorMetadataOnce(client);
      log.info(
        { host: this.host },
        "metadata mirror: link ended, awaiting next client",
      );
      // Mirror returned — link is dead or transitioning. Wait until
      // the session leaves `connected` so the next iteration blocks
      // until a fresh respawn rather than spinning on a dead client.
      await waitForDisconnected(session);
    }
  }

  private async mirrorMetadataOnce(
    client: AgentClient<AgentContract>,
  ): Promise<void> {
    await mirrorRemoteCollection<TerminalId, AgentTerminalMetadata>({
      label: `${this.host}/terminalMetadata`,
      log: (line) => log.warn({ host: this.host }, line),
      keys: client.surface.terminalMetadata.keys({}),
      get: (id, signal) =>
        client.surface.terminalMetadata.get({ key: id }, { signal }),
      onUpsert: (id, agentMeta) => {
        const entry = getTerminal(id);
        if (!entry) return;
        updateServerLiveMetadata(entry, id, (m) => {
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
        // The kill flow + per-terminal exit watcher own removal from
        // the parent's registry — mirror-side notifications would race.
      },
    });
  }

  /** Run one RPC against the *current* client of the session. The
   *  session manages identity across reconnects; we always consult
   *  `currentClient()` rather than caching, so callers after a link
   *  drop don't see a stale dead promise. */
  async callAgent<T>(
    fn: (client: AgentClient<AgentContract>) => Promise<T>,
  ): Promise<T> {
    const session = await this.ensureSession();
    const cp = session.currentClient();
    if (!cp) {
      // Between disconnect and reconnect — surface a clean error to
      // the foreground caller so write/resize/kill don't hang forever.
      throw new Error(`remote agent on ${this.host} is disconnected`);
    }
    const client = await cp;
    const result = await fn(client);
    if (!this.connectedAcked) {
      session.markConnected();
      this.connectedAcked = true;
    }
    return result;
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
    // Seed `connectionState` synchronously so the `<DisconnectedOverlay>`
    // renders the moment the tile appears. Without this, the overlay
    // stays hidden until `session.onState` fires its first transition
    // (which doesn't happen until `getKoluHostSessionAsync` resolves
    // the drvPath — measurable seconds even on a warm path). The
    // session subscription will overwrite `connectionState` with the
    // real `copying → connecting → connected` lifecycle as soon as
    // the HostSession resolves.
    meta.connectionState = "copying";
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
    this.records.set(id, { abort, handle });

    void this.spawnAsync(id, opts, entry, handle, abort.signal).catch((err) => {
      tlog.error({ err }, "remote spawn failed — cleaning up local registry");
      // The tile rendered with pid=0 and writes were silently
      // dropping `remote write failed` warns. Tear the entry out
      // synchronously so the UI shows the failure instead of a
      // stuck "Connecting…" tile that the user has to manually kill.
      this.localCleanup(id, /* exitCode */ -1);
    });

    return entry.info;
  }

  /** Local-side cleanup for a remote terminal: aborts pumps, removes
   *  the registry entry + metadata, publishes terminalExit so the
   *  client gets the toast, disposes the parent-side mirrored headless
   *  buffer. Used by:
   *   - spawn-failure tail (synthetic exit code -1),
   *   - the agent's `terminalExit` event watcher (real code),
   *   - link-death (synthetic code -1, when the exit watcher's
   *     iterator errors before yielding),
   *   - `killTerminal` (synchronous local teardown — RPC is fire-and-
   *     forget separately).
   *  Idempotent: a second call after the entry is already removed
   *  no-ops, so racing exit signals don't double-publish. */
  private localCleanup(id: TerminalId, exitCode: number): void {
    const record = this.records.get(id);
    if (!record) return; // already cleaned up
    record.abort.abort();
    record.handle.dispose();
    this.records.delete(id);
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    unregisterTerminal(id);
    surfaceCtx.cells.terminalList.set(listTerminals());
    surfaceCtx.collections.terminalMetadata.remove(id);
    terminalsDirtyChannel.publish({});
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
    //
    // Per-terminal pumps consume the *current* client at spawn time.
    // Agent restart kills the terminal by construction (agent has no
    // memory of it after respawn), so we don't try to reattach —
    // instead the exit watcher synthesizes -1 on link death and
    // `localCleanup` removes the tile.
    const client = await this.callAgent(async (c) => c);
    void this.pumpStream(
      () => client.surface.terminalData.get({ id }, { signal }),
      id,
      "data",
      signal,
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
    // Watch the agent's terminalExit event. Resolves with the real
    // exit code on natural exit, or -1 if the link dies before the
    // agent can publish (since the agent's exit handler runs in-
    // process, any clean disconnect means the agent already died).
    void this.watchExit(client, id, signal);
  }

  private async watchExit(
    client: AgentClient<AgentContract>,
    id: TerminalId,
    signal: AbortSignal,
  ): Promise<void> {
    const tlog = log.child({ host: this.host, terminal: id });
    let exitCode = -1;
    try {
      const iter = await client.surface.terminalExit.get({ id }, { signal });
      for await (const code of iter) {
        exitCode = code as number;
        break; // event is single-yield-then-close
      }
    } catch (err) {
      if (signal.aborted) return; // local kill aborted us; cleanup happens in killTerminal
      tlog.warn(
        { err },
        "remote exit watcher failed — synthesizing disconnect exit",
      );
    }
    if (signal.aborted) return;
    tlog.info({ exitCode }, "remote terminal exited");
    this.localCleanup(id, exitCode);
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
    const info = entry.info;
    // Fire-and-forget kill RPC. The agent's onExit handler will
    // publish terminalExit, but our `watchExit` is aborted by
    // `localCleanup` below — so we use an explicit exit code (0) for
    // the parent-side publish, matching the local backend's contract
    // (operator-initiated kill = clean exit from the client's POV).
    void this.callAgent((c) => c.surface.terminal.kill({ id })).catch((err) =>
      log.warn(
        { err, host: this.host, terminal: id },
        "remote kill RPC failed",
      ),
    );
    this.localCleanup(id, 0);
    return info;
  }

  killAllTerminals(): void {
    const entries = drainTerminals();
    const ids = entries.map((e) => e.info.id);
    // localCleanup removes from this.records; iterate via snapshot.
    for (const id of ids) {
      const record = this.records.get(id);
      record?.abort.abort();
      record?.handle.dispose();
    }
    this.records.clear();
    for (const id of ids) {
      void this.callAgent((c) => c.surface.terminal.kill({ id })).catch(() => {
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

/** Resolve once the session's connection is anything other than
 *  `connected` (snapshot or future). Used after a mirror cycle ends
 *  to gate the next `waitForConnected` on a fresh respawn rather
 *  than spinning on a dead client.
 *
 *  `onState` fires the snapshot synchronously inside `session.onState(...)`,
 *  so a naive subscribe-then-check would reference `unsub` while it's
 *  still in the TDZ on the disconnected-at-attach path. Pre-check the
 *  snapshot to short-circuit; once we know we're `connected`, the
 *  callback can only fire after `unsub` is bound. */
function waitForDisconnected(
  session: HostSession<AgentContract>,
): Promise<void> {
  return new Promise((resolve) => {
    if (session.isDestroyed() || session.current().connection !== "connected") {
      resolve();
      return;
    }
    const unsub = session.onState((s) => {
      if (s.connection !== "connected" || session.isDestroyed()) {
        unsub();
        resolve();
      }
    });
  });
}

/** Resolve on the next state delta (skipping the snapshot). */
function waitForStateChange(
  session: HostSession<AgentContract>,
): Promise<void> {
  return new Promise((resolve) => {
    let first = true;
    const unsub = session.onState(() => {
      if (first) {
        first = false;
        return;
      }
      unsub();
      resolve();
    });
  });
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
          const iter = await backend.callAgent((c) =>
            c.surface.fsRepoChange.get({ repoPath }, { signal: ac.signal }),
          );
          for await (const _ of iter) onChange();
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
          const iter = await backend.callAgent((c) =>
            c.surface.fsFileChange.get(
              { repoPath, filePath },
              { signal: ac.signal },
            ),
          );
          for await (const _ of iter) onChange();
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
