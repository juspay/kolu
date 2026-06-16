/**
 * `buildWatcherServer` — the kolu-watcher surface implementation.
 *
 * One `serveOverStdio` server over the host's ssh stdio, composing the three
 * concerns the `watcherSurface` declares:
 *
 *   - PTY (absorbed) — every pty-host verb/tap FORWARDS to the host-local
 *     kaval sub-client (`HostKaval`). kolu-watcher is a kaval CLIENT here, not
 *     a relay; kaval stays a separate durable daemon.
 *   - fs/git — served from the host's real filesystem via the SAME
 *     `makeFsGit` impl kolu-server uses locally (one-shot reads as procedures,
 *     change-subscriptions as `repoChange`/`fileChange` tick streams).
 *   - terminalMetadata — produced by running kolu's provider DAG
 *     (`@kolu/terminal-dag`) host-side, FRESH per build (this process re-runs,
 *     it is not adopted), feeding the served `terminalMetadata` collection that
 *     kolu-server mirrors back.
 *
 * Provider lifecycle mirrors `LocalTerminalEndpoint`: a spawn (forwarded to
 * kaval) starts a per-terminal DAG fed by kaval's taps; a kill / natural exit
 * tears it down. Terminals already alive on an adopted kaval are picked up at
 * startup (`adoptExisting`) — so a watcher restart re-establishes the mirror
 * without disturbing the running PTYs.
 */

import { implement } from "@orpc/server";
import {
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
} from "@kolu/surface/server";
import {
  bridgeStream,
  initialServerMeta,
  makeFsGit,
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "@kolu/terminal-dag";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import type { Logger } from "pino";
import type { HostKaval } from "./kavalClient.ts";
import { forwardStream, tickStream } from "./streamBridge.ts";
import { watcherSurface } from "./watcherSurface.ts";

export interface BuildWatcherServerOptions {
  /** The host-local kaval the watcher forwards pty verbs/taps to. */
  kaval: HostKaval;
  log: Logger;
}

export interface WatcherServer {
  /** The oRPC router to serve over stdio (already prefix-flattened). */
  // biome-ignore lint/suspicious/noExplicitAny: implementSurface's Lazy<Router> isn't typed by oRPC; runtime shape is a valid router (same cast kolu-server + the rpm example use).
  router: any;
  /** Stop every provider DAG and drop the kaval connection. The durable kaval
   *  daemon is NOT stopped — it outlives this link by design. */
  dispose: () => void;
}

interface ProviderLifecycle {
  abort: AbortController;
  stopProviders: () => void;
}

export function buildWatcherServer(
  opts: BuildWatcherServerOptions,
): WatcherServer {
  const { kaval, log } = opts;
  const { fs, git } = makeFsGit(log);

  const metaStore = new Map<TerminalId, TerminalMetadata>();
  const lifecycles = new Map<TerminalId, ProviderLifecycle>();

  // Wired after `implementSurface` so the DAG hooks can publish into the
  // collection. The collection's own `upsert`/`remove` mutate `metaStore`; the
  // ctx methods do that AND publish per-key deltas to subscribers.
  let publishMeta: (id: TerminalId, meta: TerminalMetadata) => void = () => {};
  let dropMeta: (id: TerminalId) => void = () => {};

  /** Start the per-terminal provider DAG: bridge kaval's taps onto in-memory
   *  channels, run `startProviders` with hooks that publish into the served
   *  `terminalMetadata` collection. Idempotent per id. */
  function startProviderLayer(id: TerminalId, pid: number, cwd: string): void {
    if (lifecycles.has(id)) return;
    const abort = new AbortController();
    const { signal } = abort;

    const channels: ProviderChannels = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel(),
      git: inMemoryChannel(),
    };
    // Watcher seeds `pr: absent`; kolu-server's createMetadata seeds `pending`
    // (its PR provider is about to poll). The one deliberate difference, the
    // field set otherwise shared via @kolu/terminal-dag's initialServerMeta.
    const meta = initialServerMeta(cwd, { pr: { kind: "absent" } });
    const record: ProviderRecord = { pid, meta, currentAgent: null };
    publishMeta(id, meta);

    const hooks: ProviderHooks = {
      log,
      updateServerMetadata: (_record, mutate) => {
        mutate(meta);
        publishMeta(id, meta);
      },
      updateServerLiveMetadata: (_record, mutate) => {
        mutate(meta);
        publishMeta(id, meta);
      },
      // No activity feed on the watcher — recent-repos/agents are kolu-server's
      // cross-terminal MRUs, derived browser-side. The DAG omits them safely.
      readScreenText: (tailLines) =>
        kaval.client.surface.terminal
          .getScreenText({ id, tailLines })
          .then((r) => r.text),
    };

    bridgeStream(
      log,
      kaval.client.surface.cwd.get({ id }, { signal }),
      signal,
      (m) => {
        meta.cwd = m.cwd;
        publishMeta(id, meta);
        channels.cwd.publish(m.cwd);
      },
    );
    bridgeStream(
      log,
      kaval.client.surface.title.get({ id }, { signal }),
      signal,
      (m) => channels.title.publish(m.title),
    );
    bridgeStream(
      log,
      kaval.client.surface.commandRun.get({ id }, { signal }),
      signal,
      (m) => channels.commandRun.publish(m.command),
    );
    bridgeStream(
      log,
      kaval.client.surface.foreground.get({ id }, { signal }),
      signal,
      (m) =>
        channels.foreground.publish({
          process: m.process,
          foregroundPid: m.foregroundPid,
        }),
    );

    const stopProviders = startProviders(record, id, channels, hooks);

    bridgeStream(
      log,
      kaval.client.surface.exit.get({ id }, { signal }),
      signal,
      () => stopProviderLayer(id),
      (err) =>
        log.error({ err, terminal: id }, "watcher: kaval exit tap failed"),
    );

    lifecycles.set(id, { abort, stopProviders });
  }

  /** Tear down a terminal's DAG + tap bridges and drop its mirrored metadata.
   *  Idempotent. Aborting the signal ends every tap (including `exit`), so a
   *  kill that calls this before forwarding can't double-fire teardown. */
  function stopProviderLayer(id: TerminalId): void {
    const lc = lifecycles.get(id);
    if (!lc) return;
    lifecycles.delete(id);
    lc.abort.abort();
    lc.stopProviders();
    dropMeta(id);
  }

  function stopAll(): void {
    for (const id of [...lifecycles.keys()]) stopProviderLayer(id);
  }

  const fragment = implementSurface(watcherSurface, {
    channel: inMemoryChannelByName(),
    collections: {
      terminalMetadata: {
        readAll: () => metaStore,
        upsert: (key, value) => {
          metaStore.set(key, value);
        },
        remove: (key) => {
          metaStore.delete(key);
        },
      },
    },
    streams: {
      // Absorbed pty taps — forwarded straight from kaval (its snapshot-then-
      // delta framing is preserved through the pass-through).
      terminalAttach: {
        source: (input, signal) =>
          forwardStream(
            kaval.client.surface.terminalAttach.get(input, { signal }),
            signal,
          ),
      },
      cwd: {
        source: (input, signal) =>
          forwardStream(
            kaval.client.surface.cwd.get(input, { signal }),
            signal,
          ),
      },
      title: {
        source: (input, signal) =>
          forwardStream(
            kaval.client.surface.title.get(input, { signal }),
            signal,
          ),
      },
      commandRun: {
        source: (input, signal) =>
          forwardStream(
            kaval.client.surface.commandRun.get(input, { signal }),
            signal,
          ),
      },
      foreground: {
        source: (input, signal) =>
          forwardStream(
            kaval.client.surface.foreground.get(input, { signal }),
            signal,
          ),
      },
      exit: {
        source: (input, signal) =>
          forwardStream(
            kaval.client.surface.exit.get(input, { signal }),
            signal,
          ),
      },
      // fs change notifications — re-served from the host's parcel watchers.
      repoChange: {
        source: (input, signal) =>
          tickStream(
            (onChange) => fs.subscribeRepoChange(input.repoPath, onChange),
            signal,
          ),
      },
      fileChange: {
        source: (input, signal) =>
          tickStream(
            (onChange) =>
              fs.subscribeFileChange(input.repoPath, input.filePath, onChange),
            signal,
          ),
      },
    },
    procedures: {
      terminal: {
        spawn: async ({ input }) => {
          const res = await kaval.client.surface.terminal.spawn(input);
          startProviderLayer(res.id, res.pid, res.cwd);
          return res;
        },
        kill: async ({ input }) => {
          stopProviderLayer(input.id);
          return kaval.client.surface.terminal.kill(input);
        },
        killAll: async ({ input }) => {
          stopAll();
          return kaval.client.surface.terminal.killAll(input);
        },
        write: ({ input }) => kaval.client.surface.terminal.write(input),
        resize: ({ input }) => kaval.client.surface.terminal.resize(input),
        list: ({ input }) => kaval.client.surface.terminal.list(input),
        getScreenState: ({ input }) =>
          kaval.client.surface.terminal.getScreenState(input),
        getScreenText: ({ input }) =>
          kaval.client.surface.terminal.getScreenText(input),
      },
      system: {
        version: ({ input }) => kaval.client.surface.system.version(input),
        heartbeat: ({ input }) => kaval.client.surface.system.heartbeat(input),
        info: ({ input }) => kaval.client.surface.system.info(input),
      },
      git: {
        getStatus: ({ input }) => git.getStatus(input.repoPath, input.mode),
        getDiff: ({ input }) =>
          git.getDiff(
            input.repoPath,
            input.filePath,
            input.mode,
            input.oldPath,
          ),
      },
      fs: {
        listAll: ({ input }) => fs.listAll(input.repoPath),
        readFile: ({ input }) => fs.readFile(input.repoPath, input.filePath),
        statFileMtimeMs: async ({ input }) => ({
          mtimeMs: await fs.statFileMtimeMs(input.repoPath, input.filePath),
        }),
      },
    },
  });

  // Spread here, not at the call sites: the collection upsert needs a fresh
  // object reference for change detection, but that is the collection's concern,
  // not every publisher's — so the per-terminal `meta` it owns is copied once,
  // here, rather than spread at each of the four publish sites.
  publishMeta = (id, meta) =>
    fragment.ctx.collections.terminalMetadata.upsert(id, { ...meta });
  dropMeta = (id) => fragment.ctx.collections.terminalMetadata.remove(id);

  // Pick up terminals already alive on an adopted kaval (a watcher restart, or
  // a kaval that outlived a previous kolu-server). Fire-and-forget; a failure
  // here just means no metadata until the next spawn, not a dead watcher.
  void adoptExisting();
  async function adoptExisting(): Promise<void> {
    try {
      const { entries } = await kaval.client.surface.terminal.list({});
      for (const e of entries) startProviderLayer(e.id, e.pid, e.cwd);
    } catch (err) {
      log.error({ err }, "watcher: adopting existing kaval terminals failed");
    }
  }

  const router = implement(watcherSurface.contract).router({
    ...fragment.router,
  });

  return {
    router,
    dispose: () => {
      stopAll();
      kaval.dispose();
    },
  };
}
