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
 * is an in-process `Channel`. R4c wraps this same event stream in a surface
 * contract over a unix socket (stdio transport), and R-2 adds the ssh
 * variant. The event shape is transport-independent by design, so R4c adds
 * an *encoding*, not a new boundary — the one in-process-only seam is the
 * `spawn` handle, which becomes RPC-backed there. See
 * `docs/plans/remote-terminals.html` (R4a–R4d).
 *
 * What crosses the boundary, agent → kolu-server (`AgentMetadataEvent`):
 *
 *   - `metadataPersisted` / `metadataLive` — the two halves of the
 *     per-terminal metadata partition. A persisted-field change rides
 *     `metadataPersisted` (kolu-server fires `terminals:dirty`); a live-only
 *     change rides `metadataLive` (it must NOT) — the autosave-firehose
 *     fence, carried by the event TYPE rather than a flag.
 *   - `recentRepo` / `recentAgent` — activity-feed signals. The feed is a
 *     cross-terminal *kolu-server* aggregate (recent-repos / recent-agents
 *     MRUs), so the agent forwards the signal rather than mutating the feed
 *     it can't reach once remote.
 *   - `exit` — a *natural* PTY exit. An explicit `kill` does NOT emit one
 *     (the kill RPC's own response drives client cleanup), matching the
 *     pre-R4b `LocalTerminalBackend` behavior exactly.
 */

import { createPtyHost, type PtyHost, type PtySpawnOpts } from "@kolu/pty-host";
import { type Channel, inMemoryChannel } from "@kolu/surface/server";
import { DEFAULT_SCROLLBACK } from "kolu-common/config";
import type {
  LiveTerminalFields,
  ServerPersistedTerminalFields,
  TerminalId,
  TerminalServerMetadata,
} from "kolu-common/surface";
import type {
  TerminalAttachment,
  TerminalHandle,
} from "kolu-common/terminalBackend";
import type { GitInfo } from "kolu-git/schemas";
import type { Logger } from "kolu-shared";
import { createMetadata } from "./metadata.ts";
import {
  createProviderActivations,
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
  // The metadata event is split along the SAME persisted-vs-live partition
  // `metadata.ts` enforces, so the autosave fence rides the event TYPE
  // rather than a routing flag: `metadataPersisted` ⟹ consumer fires
  // `terminals:dirty`, `metadataLive` ⟹ it does not. Each variant carries
  // ONLY its half, typed — so the consumer applies it with one
  // `Object.assign` and a new field can't be silently dropped at the seam.
  | {
      kind: "metadataPersisted";
      id: TerminalId;
      fields: ServerPersistedTerminalFields;
    }
  | { kind: "metadataLive"; id: TerminalId; fields: LiveTerminalFields }
  | { kind: "recentRepo"; root: string; name: string }
  | { kind: "recentAgent"; command: string }
  | { kind: "exit"; id: TerminalId; exitCode: number };

/** Project the server-persisted half of a metadata snapshot. The literal
 *  is exhaustive over `ServerPersistedTerminalFields`, so adding a field to
 *  that schema fails to compile here until it's included — the partition
 *  stays a one-place change (the schema), enforced at this seam. */
function persistedFields(
  m: TerminalServerMetadata,
): ServerPersistedTerminalFields {
  return {
    cwd: m.cwd,
    git: m.git,
    lastAgentCommand: m.lastAgentCommand,
    lastActivityAt: m.lastActivityAt,
  };
}

/** Project the live half of a metadata snapshot (exhaustive, as above). */
function liveFields(m: TerminalServerMetadata): LiveTerminalFields {
  return { pr: m.pr, agent: m.agent, foreground: m.foreground };
}

export interface Agent {
  /** The single agent → consumer metadata + lifecycle stream. Subscribe
   *  once, before any spawn, and demux by terminal id. */
  readonly metadata: Channel<AgentMetadataEvent>;
  /** Spawn a PTY and start its provider DAG. Returns everything the
   *  consumer needs to register its entry synchronously, before the first
   *  streamed update arrives: the resolved id (the host generates one if
   *  `opts.id` is absent), pid, the initial server metadata, and the
   *  byte-stream `handle`.
   *
   *  The handle rides the spawn result rather than a separate `handle(id)`
   *  lookup so its lifetime is the terminal's, and so the one member that
   *  can't survive R4c — an in-process `PtyHandle` can't cross a socket —
   *  is the only thing that changes there: at R4c `spawn` returns a
   *  `TerminalHandle` backed by RPCs, same interface. The `TerminalHandle`
   *  type already hides the host-only members (cwd / process /
   *  foregroundPid) the providers read via `record.ptyHandle`. */
  spawn(
    opts: PtySpawnOpts & {
      /** Restored `lastActivityAt` (session restore). Seeds the agent's
       *  recency clock so re-detecting a resumed agent doesn't bump it:
       *  `shouldBumpRecencyForAgentChange` keys off the pre-restore value,
       *  and the agent's `record.meta` is distinct from kolu-server's, so
       *  without this seed the restored recency would be clobbered to "now"
       *  on the first post-restore detection. */
      restoredActivityAt?: number;
    },
  ): {
    id: TerminalId;
    pid: number;
    meta: TerminalServerMetadata;
    handle: TerminalHandle;
  };
  attach(id: TerminalId, signal: AbortSignal | undefined): TerminalAttachment;
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
  // Shared across this agent's terminals (install-once per provider kind);
  // a second agent instance gets its own, never sharing install state.
  const activations = createProviderActivations();
  // id → teardown closure (aborts the tap bridges + stops the provider DAG).
  // Its keys ARE the live terminals; the `ProviderRecord` itself stays a
  // pure value captured by the providers' closures, never stored here.
  const teardowns = new Map<TerminalId, () => void>();

  /** Pump a pty-host tap into an internal provider channel until the tap
   *  ends or `signal` aborts (kill). The in-process channel ends an aborted
   *  subscription with a clean `{done:true}` (no throw), so this catch
   *  never fires on a kill today — but a socket/ssh transport (R4c/R-2)
   *  surfaces abort as a thrown error, so an aborted signal is treated as
   *  expected teardown, not a failure, to survive that move. */
  function bridgeStream<T>(
    iter: AsyncIterable<T>,
    signal: AbortSignal,
    onEvent: (value: T) => void,
  ): void {
    void (async () => {
      try {
        for await (const value of iter) onEvent(value);
      } catch (err) {
        if (signal.aborted) return;
        log.error({ err }, "pty-host bridge subscription failed");
      }
    })();
  }

  /** The provider DAG's metadata writes become stream events. The mutator
   *  types come straight from `ProviderHooks`, so the persisted-vs-live
   *  write fence is enforced here exactly as it was in `metadata.ts` — a
   *  provider still can't write `m.agent` through `updateServerMetadata`.
   *  `trackRecent*` forward to the consumer's activity feed. */
  function makeHooks(record: ProviderRecord, id: TerminalId): ProviderHooks {
    return {
      updateServerMetadata: (_record, mutate) => {
        mutate(record.meta);
        metadata.publish({
          kind: "metadataPersisted",
          id,
          fields: persistedFields(record.meta),
        });
      },
      updateServerLiveMetadata: (_record, mutate) => {
        mutate(record.meta);
        metadata.publish({
          kind: "metadataLive",
          id,
          fields: liveFields(record.meta),
        });
      },
      trackRecentRepo: (root, name) =>
        metadata.publish({ kind: "recentRepo", root, name }),
      trackRecentAgent: (command) =>
        metadata.publish({ kind: "recentAgent", command }),
    };
  }

  /** Tear down a terminal: abort its tap bridges + stop its provider DAG.
   *  Idempotent — returns whether it actually ran (`false` ⟹ already torn
   *  down). That return is how a natural exit decides to emit `exit` while
   *  an intentional kill stays silent. */
  function teardown(id: TerminalId): boolean {
    const stop = teardowns.get(id);
    if (!stop) return false;
    teardowns.delete(id);
    stop();
    return true;
  }

  return {
    metadata,

    spawn(opts) {
      const { restoredActivityAt, ...ptyOpts } = opts;
      const { id, pid } = host.spawn({
        scrollback: DEFAULT_SCROLLBACK,
        ...ptyOpts,
      });
      const ptyHandle = host.handle(id);
      const bridge = new AbortController();
      const channels: ProviderChannels = {
        cwd: inMemoryChannel<string>(),
        title: inMemoryChannel<string>(),
        commandRun: inMemoryChannel<string>(),
        git: inMemoryChannel<GitInfo | null>(),
      };
      const record: ProviderRecord = {
        ptyHandle,
        meta: createMetadata(ptyHandle.cwd),
        currentAgent: null,
      };
      // Seed the recency clock from the restored value (if any) BEFORE the
      // detectors run, so re-detecting a resumed agent preserves it.
      if (restoredActivityAt !== undefined)
        record.meta.lastActivityAt = restoredActivityAt;
      const hooks = makeHooks(record, id);

      // Bridge pty-host's VT taps onto the agent-internal provider
      // channels. cwd ALSO lands on persisted metadata (the bridge owns
      // `m.cwd`; the git provider reads `channels.cwd` to re-resolve git) —
      // exactly the split the pre-R4b LocalTerminalBackend had, relocated.
      bridgeStream(
        host.subscribeCwd(id, bridge.signal),
        bridge.signal,
        (cwd) => {
          hooks.updateServerMetadata(record, (m) => {
            m.cwd = cwd;
          });
          channels.cwd.publish(cwd);
        },
      );
      bridgeStream(
        host.subscribeTitle(id, bridge.signal),
        bridge.signal,
        (title) => channels.title.publish(title),
      );
      bridgeStream(
        host.subscribeCommandRun(id, bridge.signal),
        bridge.signal,
        (raw) => channels.commandRun.publish(raw),
      );
      const stopProviders = startProviders(
        record,
        id,
        channels,
        hooks,
        activations,
      );

      // Register teardown only once the terminal is fully built — there is
      // no placeholder window where a racing exit could run a no-op.
      teardowns.set(id, () => {
        bridge.abort();
        stopProviders();
      });

      void host.exitPromise(id).then((exitCode) => {
        if (teardown(id)) metadata.publish({ kind: "exit", id, exitCode });
      });

      return { id, pid, meta: { ...record.meta }, handle: ptyHandle };
    },

    attach(id, signal) {
      return host.attach(id, signal);
    },

    kill(id) {
      teardown(id);
      host.kill(id);
    },

    killAll() {
      const ids = [...teardowns.keys()];
      for (const id of ids) teardown(id);
      for (const id of ids) host.kill(id);
    },

    dispose() {
      host.dispose();
    },
  };
}
