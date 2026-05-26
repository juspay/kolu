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
 *
 * Prototype scope: method bodies sketch the intended oRPC calls; the
 * actual `client` object is left wired-to-undefined until R-3 plumbs
 * the standard-peer transport.
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
import type { HostSession } from "./host-session.ts";

export class RemoteBackend implements Backend {
  readonly id: TerminalLocation;

  constructor(private readonly session: HostSession) {
    this.id = { kind: "ssh", host: session.host };
  }

  async spawnPty(opts: PtySpawnOpts): Promise<TerminalHandle> {
    log.info({ host: this.session.host }, "RemoteBackend.spawnPty");
    // R-3: `const { id } = await this.session.client.terminal.spawn({
    //   cwd: opts.cwd, initialMetadata: opts.initialMetadata })`
    // Then register `id` with the session so HostSession state changes
    // publish to this terminal's connectionState channel.
    const id = crypto.randomUUID(); // stub
    this.session.registerTerminal(id);
    return {
      id,
      write: (_data) => {
        // R-3: this.session.client.terminal.write({ id, data: _data })
      },
      resize: (_cols, _rows) => {
        // R-3: this.session.client.terminal.resize({ id, cols, rows })
      },
    };
  }

  terminalChannel<K extends keyof TerminalChannelMap>(
    terminalId: string,
    _kind: K,
    _signal?: AbortSignal,
  ): AsyncIterable<TerminalChannelMap[K]> {
    // R-3: route per kind:
    //   "data" → this.session.client.terminal.channelData({ id: terminalId })
    //   "agent" → this.session.client.terminal.channelAgent({ id })
    //   "connectionState" → tap session.onStateChange (in-process, no RPC)
    //   …etc per the agentContract channels.
    //
    // For `connectionState` we intercept at this layer rather than
    // going over the wire — the agent doesn't know what state the
    // local server perceives the connection in. HostSession's state
    // machine is the truth.
    log.warn(
      { host: this.session.host, terminalId, kind: _kind },
      "RemoteBackend.terminalChannel: prototype stub",
    );
    // Return an empty iterator that respects abort.
    return {
      async *[Symbol.asyncIterator]() {
        // R-3 stub: yields nothing.
      },
    };
  }

  killTerminal(_terminalId: string): boolean {
    // R-3: await this.session.client.terminal.kill({ id: _terminalId })
    this.session.unregisterTerminal(_terminalId);
    return true;
  }

  killTerminalEntry(entry: {
    info: { id: string };
    handle: { dispose(): void };
    stopProviders: () => void;
  }): void {
    // For RemoteBackend the local `entry.handle.dispose` is a no-op
    // proxy; the real kill is the RPC. The `stopProviders` call
    // tears down any local subscribers (the metadata aggregator).
    entry.stopProviders();
    void this.killTerminal(entry.info.id);
  }

  async uploadFile(
    terminalId: string,
    _name: string,
    _base64Data: string,
  ): Promise<string> {
    // R-3: const { path } = await this.session.client.terminal.uploadFile({
    //   id: terminalId, name: _name, base64Data: _base64Data
    // })
    // return path
    log.warn({ terminalId }, "RemoteBackend.uploadFile: prototype stub");
    return `/tmp/kolu-agent-stub/${terminalId}/${_name}`;
  }

  fs: BackendFs = {
    listAll: async (_repoPath) => {
      // R-3: return this.session.client.fs.listAll({ repoPath: _repoPath })
      return [];
    },
    readFile: async (_repoPath, _filePath) => {
      // R-3: return this.session.client.fs.readFile({ repoPath, filePath })
      return { content: "", truncated: false };
    },
    subscribeRepoChange: (_repoPath, _signal) => {
      // R-3: iterate this.session.client.fs.subscribeRepoChange({ repoPath })
      return {
        async *[Symbol.asyncIterator]() {
          /* stub */
        },
      };
    },
    subscribeFileChange: (_repoPath, _filePath, _signal) => {
      return {
        async *[Symbol.asyncIterator]() {
          /* stub */
        },
      };
    },
  };

  git: BackendGit = {
    getDiff: async (_repoPath, _filePath, _mode, _oldPath) => {
      // R-3: this.session.client.git.getDiff({ ... })
      return {
        oldFileName: null,
        newFileName: null,
        hunks: [],
        binary: false,
      };
    },
    getStatus: async (_repoPath, _mode) => {
      // R-3: this.session.client.git.getStatus({ ... })
      return { files: [], base: null };
    },
    subscribeRepoChange: (_repoPath, _signal) => {
      return {
        async *[Symbol.asyncIterator]() {
          /* stub */
        },
      };
    },
  };
}
