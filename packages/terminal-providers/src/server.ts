/**
 * `buildWatcherServer` — the host-resident awareness server, served as a plain
 * library (no `bin`, no `serveOverStdio`, no Nix). It runs the host-side
 * providers (git / PR / agent + the agent-command tracker) for every watched
 * terminal and serves their output as the `watcherSurface` awareness
 * collections.
 *
 * It returns `implementSurface`'s router, the **transport-agnostic** half of the
 * serving, plus the no-wire `directLink` `client` it owns beside that router —
 * the in-process client kolu-server's local endpoint consumes today. A remote
 * host serves the same router over `serveOverStdio` later. The consumer is
 * written against `ContractRouterClient<typeof watcherSurface.contract>` either
 * way, so *local vs remote is only the link*. This mirrors the **in-process**
 * (`router` + `directLink` `client`) half of kaval's `createInProcessPtyHost` —
 * the blessed pattern for an in-process surface. The wire-wrap half
 * (`servedRouter`, the contract-router the StandardRPCHandler routes over a
 * socket) is deferred to P4d, since it has no caller until the `stdioLink` swap.
 *
 * The watcher is **minus PTY-forwarding**: it never taps kaval. kolu-server owns
 * the pty-host taps (in-server) and relays the signals the providers consume via
 * the surface's `signal.*` procedures; the watcher publishes git / PR / agent
 * awareness back through the collections. Host capabilities the providers need
 * that aren't awareness data — reading the rendered screen for agent
 * screen-scrape, and the cross-terminal activity MRUs — are **injected** as
 * options, since they reach back into the host (in-process today; a remote
 * watcher reads its own kaval / derives its own MRUs).
 */

import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
} from "@kolu/surface/server";
import {
  LOCAL_LOCATION,
  type TerminalId,
  type TerminalServerMetadata,
} from "kolu-common/surface";
import type { Logger } from "pino";
import {
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startWatcherProviders,
} from "./providers.ts";
import {
  type LiveAwareness,
  type PersistedAwareness,
  type WatcherContract,
  watcherSurface,
} from "./watcherSurface.ts";

export interface BuildWatcherServerOptions {
  /** The host's logger, threaded to the providers via `ProviderHooks`. */
  log: Logger;
  /** Read a terminal's current rendered screen (VT-resolved plain text) — the
   *  capability the agent screen-scrape promoter (#905) needs. Injected, not
   *  served over the surface: it reaches back into the host's PTY screen buffer,
   *  which a remote watcher reads from its own kaval. Omitted ⇒ screen scrape is
   *  inactive (a screen-less host gets correct, just un-promoted, agent state). */
  readScreenText?: (id: TerminalId, tailLines?: number) => Promise<string>;
  /** Host activity-feed sinks — the cross-terminal recent-repos / recent-agents
   *  MRUs. Injected (not awareness data): in-process today, the local endpoint
   *  passes kolu-server's `activity.ts` sinks. Omitted ⇒ no MRU updates. */
  trackRecentRepo?: (root: string, name: string) => void;
  trackRecentAgent?: (cmd: string) => void;
}

/** Per-watched-terminal teardown: the channels the signals publish into + the
 *  providers' stop. */
interface WatcherLifecycle {
  channels: ProviderChannels;
  stop: () => void;
}

/** The providers' record seed for a freshly-watched terminal. Only the
 *  host-side fields it produces (git / pr / agent / lastAgentCommand /
 *  lastActivityAt) are ever published as awareness; `cwd` seeds the providers'
 *  read-once cwd, and `location`/`foreground` are inert placeholders the
 *  providers never read (the endpoint owns them in-server). */
function initialMeta(cwd: string): TerminalServerMetadata {
  return {
    cwd,
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
  };
}

const persistedOf = (m: TerminalServerMetadata): PersistedAwareness => ({
  git: m.git,
  lastAgentCommand: m.lastAgentCommand,
  lastActivityAt: m.lastActivityAt,
});

const liveOf = (m: TerminalServerMetadata): LiveAwareness => ({
  pr: m.pr,
  agent: m.agent,
});

export function buildWatcherServer(opts: BuildWatcherServerOptions) {
  const { log } = opts;
  const persistedStore = new Map<TerminalId, PersistedAwareness>();
  const liveStore = new Map<TerminalId, LiveAwareness>();
  const lifecycles = new Map<TerminalId, WatcherLifecycle>();

  // Wired after `implementSurface` so the provider hooks can publish into the
  // collections (whose `upsert` mutates the stores AND pushes per-key deltas to
  // subscribers — the `ctx` methods do both, the plain `Map` ops only the first).
  let publishPersisted: (id: TerminalId, v: PersistedAwareness) => void =
    () => {};
  let publishLive: (id: TerminalId, v: LiveAwareness) => void = () => {};
  let dropAwareness: (id: TerminalId) => void = () => {};

  /** Begin watching a terminal: per-terminal channels for the signals to feed,
   *  a record seeded at `cwd`/`pid`, hooks that publish into the awareness
   *  collections, and the host-side providers. Idempotent per id. Seeds the
   *  initial awareness BEFORE returning, so kolu-server's subsequent `get`
   *  subscribe reads a valid snapshot. */
  function startWatching(id: TerminalId, pid: number, cwd: string): void {
    if (lifecycles.has(id)) return;
    const channels: ProviderChannels = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel(),
      git: inMemoryChannel(),
    };
    const meta = initialMeta(cwd);
    const record: ProviderRecord = { pid, meta, currentAgent: null };
    const hooks: ProviderHooks = {
      log,
      updateServerMetadata: (_record, mutate) => {
        mutate(meta);
        publishPersisted(id, persistedOf(meta));
      },
      updateServerLiveMetadata: (_record, mutate) => {
        mutate(meta);
        publishLive(id, liveOf(meta));
      },
      trackRecentRepo: opts.trackRecentRepo,
      trackRecentAgent: opts.trackRecentAgent,
      readScreenText: opts.readScreenText
        ? (tailLines) => opts.readScreenText!(id, tailLines)
        : undefined,
    };
    publishPersisted(id, persistedOf(meta));
    publishLive(id, liveOf(meta));
    const stop = startWatcherProviders(record, id, channels, hooks);
    lifecycles.set(id, { channels, stop });
  }

  /** Stop watching a terminal — tear its providers down and drop its mirrored
   *  awareness. Idempotent. */
  function stopWatching(id: TerminalId): void {
    const lc = lifecycles.get(id);
    if (!lc) return;
    lifecycles.delete(id);
    lc.stop();
    dropAwareness(id);
  }

  const fragment = implementSurface(watcherSurface, {
    channel: inMemoryChannelByName(),
    collections: {
      persistedAwareness: {
        readAll: () => persistedStore,
        upsert: (key, value) => {
          persistedStore.set(key, value);
        },
        remove: (key) => {
          persistedStore.delete(key);
        },
      },
      liveAwareness: {
        readAll: () => liveStore,
        upsert: (key, value) => {
          liveStore.set(key, value);
        },
        remove: (key) => {
          liveStore.delete(key);
        },
      },
    },
    procedures: {
      terminal: {
        watch: async ({ input }) => {
          startWatching(input.id, input.pid, input.cwd);
        },
        unwatch: async ({ input }) => {
          stopWatching(input.id);
        },
      },
      signal: {
        cwd: async ({ input }) => {
          lifecycles.get(input.id)?.channels.cwd.publish(input.cwd);
        },
        title: async ({ input }) => {
          lifecycles.get(input.id)?.channels.title.publish(input.title);
        },
        foreground: async ({ input }) => {
          lifecycles.get(input.id)?.channels.foreground.publish({
            process: input.process,
            foregroundPid: input.foregroundPid,
          });
        },
        commandRun: async ({ input }) => {
          lifecycles.get(input.id)?.channels.commandRun.publish(input.command);
        },
      },
    },
  });

  publishPersisted = (id, v) =>
    fragment.ctx.collections.persistedAwareness.upsert(id, v);
  publishLive = (id, v) => fragment.ctx.collections.liveAwareness.upsert(id, v);
  dropAwareness = (id) => {
    fragment.ctx.collections.persistedAwareness.remove(id);
    fragment.ctx.collections.liveAwareness.remove(id);
  };

  return {
    /** The raw `implementSurface` fragment router, for advanced in-process use
     *  (or `serveOverStdio` over ssh later, once it's wrapped in a top-level
     *  contract router — the deferred P4d half). */
    router: fragment.router,
    /** The no-wire `directLink` client kolu-server's local endpoint consumes
     *  today — owned here, beside the router it wraps, the way
     *  `createInProcessPtyHost` owns its `client`. */
    client: directLink<WatcherContract>(fragment.router),
    /** Stop every watched terminal's providers. */
    dispose: () => {
      for (const id of [...lifecycles.keys()]) stopWatching(id);
    },
  };
}

export type WatcherServer = ReturnType<typeof buildWatcherServer>;
