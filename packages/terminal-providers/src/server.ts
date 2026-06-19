/**
 * `buildWatcherServer` — the host-resident awareness server, served as a plain
 * library (no `bin`, no `serveOverStdio`, no Nix). It runs the host-side
 * providers (git / PR / agent + the agent-command tracker) for every watched
 * terminal and serves their output as the `watcherSurface` awareness
 * collections.
 *
 * It returns the no-wire `directLink` `client` it owns over an in-process
 * `implementSurface` fragment — the client kolu-server's local endpoint consumes
 * today. The consumer is written against
 * `ContractRouterClient<typeof watcherSurface.contract>`, so when a remote host
 * serves the same surface over `serveOverStdio` later, *local vs remote is only
 * the link*. This is the **in-process** half of kaval's `createInProcessPtyHost`
 * (which returns `client` over the same fragment). Its wire-serving half — a
 * top-level contract router wrapping the fragment for `serveOverStdio` (kaval's
 * `servedRouter`) — is deferred to P4d, since nothing serves the watcher over
 * the wire until the `stdioLink` swap.
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
  LiveAwarenessSchema,
  type PersistedAwareness,
  PersistedAwarenessSchema,
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

/** Seed `record.meta` for a freshly-watched terminal. This is NOT a hand-copy of
 *  `createMetadata` (it deliberately does not own that concept — `createMetadata`
 *  lives in kolu-server, on the wrong side of the dependency direction to import
 *  here): the watcher only ever reads `cwd` (the providers' read-once cwd) and
 *  publishes the `persistedOf`/`liveOf` projections, so this seeds exactly those.
 *
 *  The PERSISTED awareness comes from `seed` — the endpoint's current value for
 *  this terminal — NOT hardcoded defaults: a fresh spawn passes `createMetadata`
 *  defaults (`git: null`, `lastActivityAt: 0`, no `lastAgentCommand`), but an
 *  ADOPTED survivor passes its restored values, which must seed `record.meta` so
 *  the eager snapshot reproduces them (the endpoint folds the snapshot back, so a
 *  defaults frame would clobber the restored `lastActivityAt`/`lastAgentCommand`)
 *  and so `agentRecency`'s restore-guard — which reads `record.meta.lastActivityAt`
 *  — fires on re-detection. The LIVE fields (`pr`, `agent`) are always re-derived
 *  on restore, so they seed to defaults. `location`/`foreground` are NEVER
 *  published (the endpoint owns them in-server); they are placeholders here
 *  solely because the over-wide `TerminalServerMetadata` type demands them. */
function initialMeta(
  cwd: string,
  seed: PersistedAwareness,
): TerminalServerMetadata {
  return {
    // The only field the providers read.
    cwd,
    // Persisted awareness — seeded from the endpoint's current value, so an
    // adopted survivor's restored fields are reproduced, not clobbered.
    ...seed,
    // Live-awareness defaults (`liveOf` publishes these) — always re-derived.
    pr: { kind: "pending" },
    agent: null,
    // Never published — type-only placeholders the endpoint owns in-server.
    location: LOCAL_LOCATION,
    foreground: null,
  };
}

/** Project the metadata onto a schema's own key set. Keyed off
 *  `Schema.keyof().options` — the awareness schemas' `.pick` keys ARE the
 *  partition — so adding a field to a `.pick` in `watcherSurface.ts` widens
 *  the projection automatically; the field list isn't re-enumerated here. */
function projectOnto<K extends keyof TerminalServerMetadata>(
  m: TerminalServerMetadata,
  keys: readonly K[],
): Pick<TerminalServerMetadata, K> {
  const out = {} as Pick<TerminalServerMetadata, K>;
  for (const k of keys) out[k] = m[k];
  return out;
}

// The awareness schemas' key sets, derived from the `.pick`ed schemas
// themselves (the single source of truth for the persisted-vs-live partition),
// so `persistedOf`/`liveOf` can't drift from the published shape.
const PERSISTED_KEYS = PersistedAwarenessSchema.keyof()
  .options as readonly (keyof PersistedAwareness &
  keyof TerminalServerMetadata)[];
const LIVE_KEYS = LiveAwarenessSchema.keyof()
  .options as readonly (keyof LiveAwareness & keyof TerminalServerMetadata)[];

/** The persisted-awareness projection of a terminal's metadata — `git`,
 *  `lastAgentCommand`, `lastActivityAt`. This is the SINGLE projection the
 *  watcher publishes AND the endpoint hands `watch` as its `seed` (`local.ts`),
 *  so the value the endpoint supplies and the value the watcher reproduces
 *  cannot drift: a field dropped from the partition is a change to
 *  `PersistedAwarenessSchema`, not a silent omission at one call site. Exported
 *  so the endpoint and its adoption regression test share it (rather than each
 *  hand-copying the field list — where a drop would be neither a compile error
 *  nor a test failure, since `lastAgentCommand` is `.optional()` and
 *  `lastActivityAt` `.default(0)`). */
export const persistedSeedOf = (
  m: TerminalServerMetadata,
): PersistedAwareness => projectOnto(m, PERSISTED_KEYS);

const liveOf = (m: TerminalServerMetadata): LiveAwareness =>
  projectOnto(m, LIVE_KEYS);

export function buildWatcherServer(opts: BuildWatcherServerOptions) {
  const { log } = opts;
  const persistedStore = new Map<TerminalId, PersistedAwareness>();
  const liveStore = new Map<TerminalId, LiveAwareness>();
  const lifecycles = new Map<TerminalId, WatcherLifecycle>();

  // Build the fragment FIRST — its collection ops touch only the plain stores,
  // and its procedures reference the hoisted `startWatching`/`stopWatching`
  // declarations below (a function declaration is visible before its textual
  // position; the procedures only CALL them post-construction, by which point
  // the publish writers below are bound). The procedures' channel-publish arms
  // depend only on `lifecycles`.
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
          startWatching(input.id, input.pid, input.cwd, input.seed);
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

  // The real publish writers, `const`-bound to the collection ctx (whose `upsert`
  // mutates the stores AND pushes per-key deltas to subscribers — the plain `Map`
  // ops only the first). No `let`-seeded no-op reassigned later: the hooks below
  // close over these consts, and a hook can only fire from inside `startWatching`,
  // which is only reachable via a procedure call (post-construction) — so the
  // writers are always the real ones by the time any publish happens.
  const publishPersisted = (id: TerminalId, v: PersistedAwareness): void =>
    fragment.ctx.collections.persistedAwareness.upsert(id, v);
  const publishLive = (id: TerminalId, v: LiveAwareness): void =>
    fragment.ctx.collections.liveAwareness.upsert(id, v);
  const dropAwareness = (id: TerminalId): void => {
    fragment.ctx.collections.persistedAwareness.remove(id);
    fragment.ctx.collections.liveAwareness.remove(id);
  };

  /** Begin watching a terminal: per-terminal channels for the signals to feed,
   *  a record seeded at `cwd`/`pid`, hooks that publish into the awareness
   *  collections, and the host-side providers. Idempotent per id. Seeds the
   *  initial awareness BEFORE returning, so kolu-server's subsequent `get`
   *  subscribe reads a valid snapshot. (A hoisted function declaration so the
   *  fragment's `watch` procedure above can reference it.) */
  function startWatching(
    id: TerminalId,
    pid: number,
    cwd: string,
    seed: PersistedAwareness,
  ): void {
    if (lifecycles.has(id)) return;
    const channels: ProviderChannels = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel(),
      git: inMemoryChannel(),
    };
    const meta = initialMeta(cwd, seed);
    const record: ProviderRecord = { pid, meta, currentAgent: null };
    const hooks: ProviderHooks = {
      log,
      updateServerMetadata: (_record, mutate) => {
        mutate(meta);
        publishPersisted(id, persistedSeedOf(meta));
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
    // Seed the served collections so the endpoint's `get` subscribe reads a
    // valid snapshot, THEN start the providers. The seed is recorded into
    // `lifecycles` only on success — if `startWatcherProviders` throws
    // synchronously, drop the seeded store entries so a half-started terminal
    // isn't stranded (neither `stopWatching` nor `dispose` would reach it).
    publishPersisted(id, persistedSeedOf(meta));
    publishLive(id, liveOf(meta));
    let stop: () => void;
    try {
      stop = startWatcherProviders(record, id, channels, hooks);
    } catch (err) {
      dropAwareness(id);
      throw err;
    }
    lifecycles.set(id, { channels, stop });
  }

  /** Stop watching a terminal — tear its providers down and drop its mirrored
   *  awareness. Idempotent. (Hoisted so the fragment's `unwatch` procedure can
   *  reference it.) */
  function stopWatching(id: TerminalId): void {
    const lc = lifecycles.get(id);
    if (!lc) return;
    lifecycles.delete(id);
    lc.stop();
    dropAwareness(id);
  }

  return {
    /** The no-wire `directLink` client kolu-server's local endpoint consumes
     *  today — built here over the in-process `implementSurface` fragment, the
     *  way `createInProcessPtyHost` owns its `client`. The wire-serving half (a
     *  top-level contract router wrapping the fragment for `serveOverStdio`, the
     *  way `createInProcessPtyHost` also returns `servedRouter`) is deferred to
     *  P4d — it has no caller until the `stdioLink` swap, and the bare fragment
     *  doesn't route over the wire, so exposing it now would be a misleading
     *  no-op field. */
    client: directLink<WatcherContract>(fragment.router),
    /** Stop every watched terminal's providers. */
    dispose: () => {
      for (const id of [...lifecycles.keys()]) stopWatching(id);
    },
  };
}

export type WatcherServer = ReturnType<typeof buildWatcherServer>;
