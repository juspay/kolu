/**
 * The in-process **agent** — the #951 R4b boundary.
 *
 * `@kolu/pty-host` owns only the PTY and what's readable off its byte
 * stream. The *agent* owns pty-host **plus the per-terminal provider DAG**
 * (`./providers.ts`: agent-command tracker, git watcher, GitHub PR watcher,
 * foreground-process observer, three agent detectors) and emits an enriched
 * per-terminal **metadata stream**. kolu-server (`./local.ts`) becomes a
 * pure consumer of that stream + the byte streams — it no longer runs
 * `startProviders` itself.
 *
 * Why the providers live here and not in kolu-server: they read *this
 * host's* filesystem, process table, and agent-state files. Co-locating
 * them with the PTY is what makes `LocalTerminalBackend` (local daemon) and
 * a future `RemoteTerminalBackend` (ssh agent) differ *only in transport* —
 * the volatility carve the remote-terminals roadmap rests on.
 *
 * In R4b the agent runs in the same process as kolu-server and `metadata`
 * is an in-process `Channel`. R4c puts the same boundary behind a unix
 * socket (stdio transport) with no boundary redraw; R-2 adds the ssh
 * variant. The contract proven in-process here is exactly what gets a
 * transport bolted on — see `docs/plans/remote-terminals.html` (R4a–R4d).
 *
 * What crosses the boundary, agent → kolu-server (`AgentMetadataEvent`):
 *
 *   - `metadata` — a full per-terminal `TerminalServerMetadata` snapshot
 *     plus a `persisted` flag. `true` ⟹ a server-persisted field changed,
 *     so kolu-server fires `terminals:dirty`; `false` ⟹ a live-only field
 *     changed, so it must NOT — the autosave-firehose fence, carried across
 *     the boundary by one bit.
 *   - `recentRepo` / `recentAgent` — activity-feed signals. The feed is a
 *     cross-terminal *kolu-server* aggregate (recent-repos / recent-agents
 *     MRUs), so the agent forwards the signal rather than mutating the feed
 *     it can't reach once remote.
 *   - `exit` — a *natural* PTY exit. An explicit `kill` does NOT emit one
 *     (the kill RPC's own response drives client cleanup), matching the
 *     pre-R4b `LocalTerminalBackend` behavior exactly.
 */

import {
  createPtyHost,
  type PtyHandle,
  type PtyHost,
  type PtySpawnOpts,
} from "@kolu/pty-host";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type { TerminalId, TerminalServerMetadata } from "kolu-common/surface";
import type { TerminalAttachment } from "kolu-common/terminalBackend";
import type { GitInfo } from "kolu-git/schemas";
import type { Logger } from "kolu-shared";
import { createMetadata } from "./metadata.ts";
import {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "./providers.ts";

/** Everything the agent emits to its consumer. One stream carries every
 *  terminal's metadata + lifecycle, tagged by id — the
 *  one-collection-keyed-by-id shape (not N parameterized streams) the
 *  remote roadmap settled on. */
export type AgentMetadataEvent =
  | {
      kind: "metadata";
      id: TerminalId;
      meta: TerminalServerMetadata;
      /** A server-persisted field changed ⟹ consumer fires
       *  `terminals:dirty`. Live-only writes set this `false`. */
      persisted: boolean;
    }
  | { kind: "recentRepo"; root: string; name: string }
  | { kind: "recentAgent"; command: string }
  | { kind: "exit"; id: TerminalId; exitCode: number };

/** Per-terminal agent state. Satisfies `ProviderRecord` (`ptyHandle` +
 *  `meta` + `currentAgent`); the rest is the agent's own bookkeeping. The
 *  VT-tap `channels` are agent-internal — pty-host's taps feed them and the
 *  provider DAG reads them; nothing outside the agent touches them. */
interface AgentTerminal extends ProviderRecord {
  channels: ProviderChannels;
  stopProviders: () => void;
  bridge: AbortController;
}

export interface Agent {
  /** The single agent → consumer metadata + lifecycle stream. Subscribe
   *  once, before any spawn, and demux by terminal id. */
  readonly metadata: Channel<AgentMetadataEvent>;
  /** Spawn a PTY and start its provider DAG. Returns the resolved id (the
   *  host generates one if `opts.id` is absent), pid, and the initial
   *  server metadata so the consumer can register its entry synchronously
   *  before the first streamed update arrives. */
  spawn(opts: PtySpawnOpts): {
    id: TerminalId;
    pid: number;
    meta: TerminalServerMetadata;
  };
  attach(id: TerminalId, signal: AbortSignal | undefined): TerminalAttachment;
  /** In-process `PtyHandle` for the byte-stream ops (write / resize /
   *  screen state). R4c replaces this with surface RPCs once the agent
   *  moves behind a socket; the `TerminalHandle` type the consumer stores
   *  it as already hides the host-only members (cwd / process /
   *  foregroundPid). */
  handle(id: TerminalId): PtyHandle;
  kill(id: TerminalId): void;
  killAll(): void;
  dispose(): void;
}

/** Construct the in-process agent. One instance per kolu process owns the
 *  single `PtyHost`. */
export function createAgent(deps: { log: Logger }): Agent {
  const { log } = deps;
  const host: PtyHost = createPtyHost({ log });
  const metadata = inMemoryChannel<AgentMetadataEvent>();
  const terminals = new Map<TerminalId, AgentTerminal>();

  /** Pump a pty-host tap into an internal provider channel until the tap
   *  ends (PTY exit) or the per-terminal `bridge` aborts (kill). Clean
   *  end-of-stream is silent; unexpected failures are logged. */
  function bridgeStream<T>(
    iter: AsyncIterable<T>,
    onEvent: (value: T) => void,
  ): void {
    void (async () => {
      try {
        for await (const value of iter) onEvent(value);
      } catch (err) {
        log.error({ err }, "pty-host bridge subscription failed");
      }
    })();
  }

  /** The provider DAG's metadata writes become stream events. The mutator
   *  types come straight from `ProviderHooks`, so the persisted-vs-live
   *  write fence is enforced here exactly as it was in `metadata.ts` — a
   *  provider still can't write `m.agent` through `updateServerMetadata`.
   *  `trackRecent*` forward to the consumer's activity feed. */
  function makeHooks(record: AgentTerminal, id: TerminalId): ProviderHooks {
    return {
      updateServerMetadata: (_record, mutate) => {
        mutate(record.meta);
        metadata.publish({
          kind: "metadata",
          id,
          meta: { ...record.meta },
          persisted: true,
        });
      },
      updateServerLiveMetadata: (_record, mutate) => {
        mutate(record.meta);
        metadata.publish({
          kind: "metadata",
          id,
          meta: { ...record.meta },
          persisted: false,
        });
      },
      trackRecentRepo: (root, name) =>
        metadata.publish({ kind: "recentRepo", root, name }),
      trackRecentAgent: (command) =>
        metadata.publish({ kind: "recentAgent", command }),
    };
  }

  /** Stop a terminal's subscriptions: abort the tap bridges, then tear
   *  down the provider DAG. Idempotent enough that the caller only ever
   *  runs it once (the record is dropped from `terminals` alongside). */
  function teardown(record: AgentTerminal): void {
    record.bridge.abort();
    record.stopProviders();
  }

  return {
    metadata,

    spawn(opts) {
      const { id, pid } = host.spawn({
        scrollback: DEFAULT_SCROLLBACK,
        ...opts,
      });
      const ptyHandle = host.handle(id);
      const bridge = new AbortController();
      const channels: ProviderChannels = {
        cwd: inMemoryChannel<string>(),
        title: inMemoryChannel<string>(),
        commandRun: inMemoryChannel<string>(),
        git: inMemoryChannel<GitInfo | null>(),
      };
      const record: AgentTerminal = {
        ptyHandle,
        meta: createMetadata(ptyHandle.cwd),
        currentAgent: null,
        channels,
        stopProviders: () => {},
        bridge,
      };
      terminals.set(id, record);
      const hooks = makeHooks(record, id);

      // Bridge pty-host's VT taps onto the agent-internal provider
      // channels. cwd ALSO lands on persisted metadata (the bridge owns
      // `m.cwd`; the git provider reads `channels.cwd` to re-resolve git) —
      // exactly the split the pre-R4b LocalTerminalBackend had, relocated.
      bridgeStream(host.subscribeCwd(id, bridge.signal), (cwd) => {
        hooks.updateServerMetadata(record, (m) => {
          m.cwd = cwd;
        });
        channels.cwd.publish(cwd);
      });
      bridgeStream(host.subscribeTitle(id, bridge.signal), (title) => {
        channels.title.publish(title);
      });
      bridgeStream(host.subscribeCommandRun(id, bridge.signal), (raw) => {
        channels.commandRun.publish(raw);
      });
      record.stopProviders = startProviders(record, id, channels, hooks);

      void host.exitPromise(id).then((exitCode) => {
        // Present ONLY on a natural exit — `kill`/`killAll` drop the record
        // first, so an intentional kill neither double-tears-down nor emits
        // `exit` (the kill RPC drives its own client cleanup).
        const rec = terminals.get(id);
        if (!rec) return;
        teardown(rec);
        terminals.delete(id);
        metadata.publish({ kind: "exit", id, exitCode });
      });

      return { id, pid, meta: { ...record.meta } };
    },

    attach(id, signal) {
      return host.attach(id, signal);
    },

    handle(id) {
      return host.handle(id);
    },

    kill(id) {
      const record = terminals.get(id);
      if (record) {
        teardown(record);
        terminals.delete(id);
      }
      host.kill(id);
    },

    killAll() {
      const entries = [...terminals.entries()];
      terminals.clear();
      for (const [, record] of entries) teardown(record);
      for (const [id] of entries) host.kill(id);
    },

    dispose() {
      host.dispose();
    },
  };
}
