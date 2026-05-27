/**
 * `RemoteTerminalBackend` — proxies every `TerminalBackend` method to a
 * `kolu --stdio` agent running on an ssh-config host. One backend
 * instance per host; the underlying `HostSession` is shared (refcounted
 * by `pin()`) across all terminals on that host.
 *
 * **MVP scope**: PTY lifecycle (spawn / kill / write / resize), data
 * stream forwarding, fs/git pass-through. `getScreenState` /
 * `getScreenText` return "" for now — the xterm.js client accumulates
 * from the live data stream after attach, which is correct for fresh
 * spawn (no scrollback to snapshot). Reconnect resilience (recovering
 * screen state after a WebSocket drop) ships with the per-terminal
 * mirrored xterm-headless seam in a follow-up.
 *
 * **No provider DAG** yet — git watcher, github PR watcher, agent
 * detectors (claude/codex/opencode), foreground-process observer all
 * live on `LocalTerminalBackend` today. Remote terminals carry only
 * the cwd that comes back through `terminalCwd` stream + the static
 * seed metadata published at spawn. Porting providers to the agent
 * side (or running them parent-side on agent's streams) is follow-up.
 */

import type { AgentClient } from "@kolu/surface-nix-host";
import type { AgentContract } from "kolu-common/agentSurface";
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
  unregisterTerminal,
} from "../terminal-registry.ts";
import { createMetadata } from "./metadata.ts";
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
  constructor(
    private readonly host: string,
    private readonly id: TerminalId,
    private readonly backend: RemoteTerminalBackend,
  ) {}
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
    // MVP: no parent-side mirrored headless terminal. Empty snapshot
    // means the client renders from live data stream after attach;
    // first-attach has nothing to snapshot anyway. Reconnect resume
    // ships in a follow-up.
    return "";
  }
  getScreenText(): string {
    return "";
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

  /** Get a client for one RPC call. Pins the session — the refcount
   *  bump persists for parent lifetime per `@kolu/surface-nix-host`'s
   *  contract (acquire/release is for scoped temporary use). Calling
   *  `pin()` is idempotent — the bumped refcount is shared across the
   *  backend's terminals on this host. */
  async callAgent<T>(
    fn: (client: AgentClient<AgentContract>) => Promise<T>,
  ): Promise<T> {
    const session = await getKoluHostSessionAsync(this.host);
    const client = await session.pin();
    const result = await fn(client);
    session.markConnected();
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

    const handle = new RemotePtyHandle(this.host, id, this);
    const meta = createMetadata(opts.cwd ?? "");
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
      tlog.error({ err }, "remote spawn failed");
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
    const session = await getKoluHostSessionAsync(this.host);
    const client = await session.pin();
    const info = await client.surface.terminal.spawn({
      id,
      cwd: opts.cwd,
      parentId: opts.parentId,
      initialMetadata: opts.initialMetadata,
    });
    handle.pid = info.pid;
    entry.info = { id, pid: info.pid };
    surfaceCtx.cells.terminalList.set(listTerminals());
    session.markConnected();
    tlog.info({ pid: info.pid }, "remote spawn ready");

    // Fan out the agent's per-terminal streams into the kolu-server's
    // local per-terminal channels. Every consumer downstream
    // (`terminal.attach`, agent detectors if any wire up against
    // remote later) subscribes to the same `terminalChannels.X(id)`
    // bus regardless of backend. Stream clients expose `.get(input,
    // {signal})` per the surface framework's convention.
    void this.pumpStream(
      () => client.surface.terminalData.get({ id }, { signal }),
      id,
      "data",
      signal,
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
  ): Promise<void> {
    try {
      const iter = await open();
      for await (const value of iter) {
        terminalChannels[channel](id).publish(value as string);
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
