/**
 * `LocalTerminalEndpoint` — this kolu process. It does **not** own `kaval`:
 * `kolu-server` is a client of a separately spawned kaval daemon, and reaches
 * it through the typed `ptyHostSurface` contract via the stable `ptyHostClient`
 * forwarding facade (`../ptyHost/index.ts`) over that daemon's own socket. This
 * endpoint forwards spawn/kill/write/resize/attach through that client and owns
 * the pty-host taps (cwd · title · command-run · foreground), wiring the
 * per-terminal awareness from them.
 *
 * Awareness is **split** (the note: PTY-tap signals run in-server; git / PR /
 * agent run host-side):
 *   - The foreground/process observer (`startProcessProvider`) — no filesystem,
 *     just the foreground/title taps — runs **in-server**, here, writing
 *     `m.foreground` straight onto the terminal's metadata.
 *   - The git / PR / agent providers — which read the host's own filesystem —
 *     run behind `@kolu/terminal-providers`' `buildWatcherServer`, consumed
 *     in-process over `directLink` (the no-wire identity link). This endpoint
 *     relays the taps to it as `signal.*` calls and folds its `persisted`/`live`
 *     awareness collections back onto the metadata. A later phase swaps only the
 *     link (`directLink` → ssh `stdioLink`) for a remote host — *local vs remote
 *     is only the link* — so this consumer is invariant under that swap.
 *
 * The providers have zero synchronous dependency on the host (they read taps,
 * not a `PtyHandle`), which is what lets them run on the far side of a link.
 *
 * `TerminalEndpoint.fs/git` stay on this side — the local surfaces shell out to
 * `kolu-git` directly; a remote endpoint mirrors the same surfaces over the
 * link.
 */

import type { ForegroundSample, PtyHostClient, PtyHostListEntry } from "kaval";
import { directLink } from "@kolu/surface/links/direct";
import { inMemoryChannel } from "@kolu/surface/server";
import {
  buildWatcherServer,
  type ProviderHooks,
  type ProviderRecord,
  startProcessProvider,
  type WatcherContract,
} from "@kolu/terminal-providers";
import { LOCAL_LOCATION } from "kolu-common/surface";
import type {
  SavedTerminal,
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import type {
  PtySpawnOpts,
  TerminalAttachment,
  TerminalEndpoint,
  TerminalEndpointFs,
  TerminalEndpointGit,
  TerminalHandle,
} from "kolu-common/terminalEndpoint";
import {
  type FsListAllOutput,
  type GitDiffOutput,
  type GitStatusOutput,
  getDiff,
  getStatus,
  listAll,
  readFile,
  statFileMtimeMs,
  subscribeFileChange,
  subscribeRepoChange,
} from "kolu-git";
import type { GitDiffMode } from "kolu-git/schemas";
import { trackRecentAgent, trackRecentRepo } from "../activity.ts";
import { log } from "../log.ts";
import { buildTerminalSpawnInput, ptyHostClient } from "../ptyHost/index.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import { surfaceCtx } from "../surfaceCtx.ts";
import {
  drainTerminals,
  getTerminal,
  listTerminals,
  registerTerminal,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import { unwrapGit } from "../unwrapGit.ts";
import {
  createMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";

// ── PTY-state notification helpers ─────────────────────────────────────

/** Notify that terminal state changed (drives debounced session auto-save).
 *  Distinct from the `terminalList` cell's content channel: this is the
 *  *trigger*, not the saved content. */
function emitTerminalsDirty(): void {
  terminalsDirtyChannel.publish({});
}

/** Republish the live `terminalList` cell. Endpoint lifecycle calls this on
 *  create / kill; client metadata setters publish via the metadata
 *  collection instead. */
function emitTerminalListChanged(): void {
  surfaceCtx.cells.terminalList.set(listTerminals());
}

// ── Local fs/git surfaces (local fs is on this machine) ─────────────────

const localFs: TerminalEndpointFs = {
  async listAll(repoPath: string): Promise<FsListAllOutput> {
    return { paths: unwrapGit(await listAll(repoPath, log)) };
  },
  async readFile(repoPath, filePath) {
    return unwrapGit(await readFile(repoPath, filePath, log));
  },
  async statFileMtimeMs(repoPath, filePath) {
    return unwrapGit(await statFileMtimeMs(repoPath, filePath, log));
  },
  subscribeRepoChange(repoPath, onChange) {
    return subscribeRepoChange(repoPath, onChange, log);
  },
  subscribeFileChange(repoPath, filePath, onChange) {
    return subscribeFileChange(repoPath, filePath, onChange, log);
  },
};

const localGit: TerminalEndpointGit = {
  async getStatus(repoPath, mode: GitDiffMode): Promise<GitStatusOutput> {
    return unwrapGit(await getStatus(repoPath, mode, log));
  },
  async getDiff(repoPath, filePath, mode, oldPath): Promise<GitDiffOutput> {
    return unwrapGit(await getDiff(repoPath, filePath, mode, log, oldPath));
  },
};

// ── The host-side awareness providers, served in-process ──────────────────

/** The git / PR / agent providers run behind `buildWatcherServer` and are
 *  consumed over `directLink` — the no-wire identity link. Built once per
 *  process (mirrors `ptyHostClient`); each watched terminal is driven through
 *  the typed client below. The injected host capabilities — screen reads for the
 *  agent screen-scrape promoter (#905) and the cross-terminal activity MRUs —
 *  reach back into this process (in-process today; a remote watcher reads its
 *  own kaval / derives its own MRUs). */
const watcherServer = buildWatcherServer({
  log,
  readScreenText: (id, tailLines) => {
    // Surface a missing terminal as NOT_FOUND — the same shape pty-host's
    // "no PTY with id" throws — so the providers' `isNotFoundError` classifies
    // the benign teardown race (the poll's terminal vanished between schedule
    // and read) as such. Swallowing it to "" instead would collapse that race
    // and a genuine lookup miss into the same empty-screen answer, defeating
    // the providers' NOT_FOUND debug path.
    const t = getTerminal(id);
    if (!t)
      throw Object.assign(new Error(`no terminal with id ${id}`), {
        code: "NOT_FOUND",
      });
    return t.handle.getScreenText(undefined, undefined, tailLines);
  },
  trackRecentRepo,
  trackRecentAgent,
});
const watcherClient = directLink<WatcherContract>(watcherServer.router);

// ── The contract-backed terminal handle ─────────────────────────────────

/** A `TerminalHandle` whose control verbs forward through the pty-host client.
 *  Every verb waits on `ready` first — `spawn` is an async RPC (even
 *  in-process the contract call resolves on a later microtask), so a tile that
 *  renders on the sync shadow can issue attach/write/resize *before* the PTY
 *  exists. Without the gate, attach hits "no PTY with id …" and early
 *  keystrokes are silently dropped. `write`/`resize` queue behind `ready`
 *  (fire-and-forget once released — the call is cheap and the PTY is the
 *  authority); `getScreenState`/`getScreenText`/`attach` await it (so the
 *  contract widened those to allow a Promise). Holds only the terminal id +
 *  pid — the live reads (cwd / process / foregroundPid) the providers need
 *  arrive over the tap streams, not this handle. */
class PtyHostTerminalProxy implements TerminalHandle {
  pid = 0;
  /** Resolves once `terminal.spawn` has created the PTY. Rejects if spawn
   *  failed, so a queued write / awaited attach surfaces the failure instead
   *  of hanging or hitting a missing PTY. */
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;

  /** The pty-host client is injected so the proxy is decoupled from how it's
   *  built — but it's a stable reference, not a thunk: this is the forwarding
   *  facade from `../ptyHost/index.ts` (`makeForwardingClient`), which resolves
   *  the endpoint's live connection on every call. So a daemon recycle (B3) is
   *  invisible here without re-pointing anything, and the proxy never needs to
   *  re-resolve per verb. */
  constructor(
    private readonly id: TerminalId,
    private readonly client: PtyHostClient,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A spawn failure with nothing yet awaiting `ready` must not reach the
    // process-wide unhandledRejection handler (which would exit the server).
    this.ready.catch(() => {});
  }

  /** PTY exists — release queued/awaiting verbs. */
  markReady(pid: number): void {
    this.pid = pid;
    this.resolveReady();
  }

  /** Spawn failed (or raced a kill) — fail queued/awaiting verbs. */
  markFailed(err: unknown): void {
    this.rejectReady(err);
  }

  write(data: string): void {
    void this.ready
      .then(() => this.client.surface.terminal.write({ id: this.id, data }))
      .catch((err) => log.error({ terminal: this.id, err }, "pty-host write"));
  }

  resize(cols: number, rows: number): void {
    void this.ready
      .then(() =>
        this.client.surface.terminal.resize({ id: this.id, cols, rows }),
      )
      .catch((err) => log.error({ terminal: this.id, err }, "pty-host resize"));
  }

  async getScreenState(): Promise<string> {
    await this.ready;
    const { data } = await this.client.surface.terminal.getScreenState({
      id: this.id,
    });
    return data;
  }

  async getScreenText(
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): Promise<string> {
    await this.ready;
    const { text } = await this.client.surface.terminal.getScreenText({
      id: this.id,
      startLine,
      endLine,
      tailLines,
    });
    return text;
  }
}

// ── Per-terminal provider bridge ───────────────────────────────────────

/** Pump a pty-host tap stream into a callback until it ends or `signal` aborts
 *  (kill / exit). The contract stream call resolves to the async iterable (a
 *  `ClientPromiseResult`), so the source is awaited first. An aborted stream
 *  surfaces as a thrown error, so an aborted signal is treated as expected
 *  teardown, not a failure. */
function bridgeStream<T>(
  source: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  // Called when the stream itself fails for a NON-abort reason (an abort is
  // expected teardown and is always swallowed). Enrichment taps (cwd / title /
  // command-run / foreground) omit it — a dropped enrichment stream just stops
  // updating that field, logged generically. The exit tap supplies one because
  // a dropped *exit* stream is a lifecycle problem, not a missing field.
  onError?: (err: unknown) => void,
): void {
  void (async () => {
    try {
      const iter = await source;
      for await (const value of iter) {
        try {
          onEvent(value);
        } catch (err) {
          // Per-event fence: a single bad event (a failed metadata publish, a
          // scratch-cleanup fs error on exit, …) must NOT escape and end the
          // `for await` loop — that would silence this tap (cwd / title /
          // foreground / exit) for the terminal for good. Log and keep
          // consuming. (This is the fence the dissolved agent metadata loop
          // carried in `applyAgentEvent`; it moved here with the taps.)
          log.error(
            { err },
            "pty-host tap onEvent threw (subscription kept alive)",
          );
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      if (onError) {
        onError(err);
        return;
      }
      log.error({ err }, "pty-host tap subscription failed");
    }
  })();
}

/** Fire-and-forget a relayed tap signal to the host-side providers. The tap is
 *  the authority and the call is cheap (a microtask over `directLink`), so it is
 *  not awaited; a failure is logged, never surfaced — a dropped relay just stops
 *  updating that provider's input, mirroring the enrichment-tap stance. */
function pushSignal(call: Promise<unknown>, id: TerminalId): void {
  void call.catch((err) =>
    log.error({ err, terminal: id }, "watcher: signal relay failed"),
  );
}

/** Hooks for the **in-server** foreground/process provider. `record.meta` IS
 *  `entry.meta` (same object), so the provider mutating its record publishes
 *  kolu-server state directly. The host-side providers' activity MRUs +
 *  screen-scrape reach kolu-server through `buildWatcherServer`'s options, not
 *  here; the process provider needs neither. */
function makeInServerHooks(
  entry: TerminalProcess,
  id: TerminalId,
): ProviderHooks {
  return {
    log,
    updateServerMetadata: (_record, mutate) =>
      updateServerMetadata(entry, id, mutate),
    updateServerLiveMetadata: (_record, mutate) =>
      updateServerLiveMetadata(entry, id, mutate),
  };
}

/** Everything needed to stop one terminal's providers + tap bridges: abort
 *  the tap-stream subscriptions and stop the in-server / host-side providers. */
interface TerminalLifecycle {
  abort: AbortController;
  stopProviders: () => void;
}

/** Best-effort `foreground` seed from a live `list` entry's `foregroundProcess`
 *  (contract 2.1). The providers re-derive the authoritative value from the
 *  surviving foreground tap (which replays a snapshot on subscribe), so this is
 *  only the pre-tap value the tile renders for the boot frame — null when the
 *  daemon reports no foreground name. `title` is unknown to the foreground field,
 *  so it stays null until the title tap fires. */
function liveForeground(
  liveEntry: PtyHostListEntry,
): TerminalMetadata["foreground"] {
  return liveEntry.foregroundProcess
    ? { name: liveEntry.foregroundProcess, title: liveEntry.title ?? null }
    : null;
}

/** The whole-record adoption mapping (B3.3): a `SavedTerminal`'s persisted fields
 *  become a live `TerminalMetadata` as a UNIT — `createMetadata` seeds the
 *  live-field defaults (pr/agent re-derived by the providers against the
 *  surviving taps), then the persisted record is spread on **whole**, never
 *  reconstructed field-by-field (the #1275 lossy-adoption class that dropped
 *  `parentId` and `lastAgentCommand`). Pure + exported so the class is closed by
 *  a schema-key round-trip test: a new persisted field rides the spread for free;
 *  a field-by-field rewrite that dropped one would fail it. `id` is the registry
 *  key, not a `meta` field, so it is split off.
 *
 *  The LIVE daemon snapshot (`liveEntry`) is the authority for `cwd` and
 *  `foreground` (F2): kaval's `cwd`/`title` taps do NOT replay a snapshot on
 *  subscribe, so a `cd` that happened while kolu-server was down — or after the
 *  last 500ms-debounced autosave — would otherwise leave the adopted tile pinned
 *  to the stale SAVED cwd until the next OSC 7, and the boot's
 *  `saveSession(snapshotSession())` would persist that stale value back over the
 *  live truth. The survivor's listed `cwd` wins; the git provider re-resolves
 *  against it on start. */
export function adoptedMeta(
  record: SavedTerminal,
  liveEntry: PtyHostListEntry,
): TerminalMetadata {
  const { id: _id, ...persisted } = record;
  return {
    ...createMetadata(liveEntry.cwd, LOCAL_LOCATION),
    ...persisted,
    cwd: liveEntry.cwd,
    foreground: liveForeground(liveEntry),
  };
}

/** Metadata for an ORPHAN survivor (B3.3): a live PTY the daemon still owns with
 *  NO saved record (F1). A create that never reached the 500ms-debounced autosave
 *  before the restart is the common case — exactly the redeploy window this
 *  feature protects — so the PTY is ADOPTED (never reaped), seeded entirely from
 *  the live daemon snapshot. Client-persisted chrome (theme/layout/intent) that
 *  never made it to disk is gone, but the live shell and its scrollback survive,
 *  which is the headline guarantee; the providers re-derive git/agent/pr from the
 *  surviving taps. */
export function orphanMeta(liveEntry: PtyHostListEntry): TerminalMetadata {
  return {
    ...createMetadata(liveEntry.cwd, LOCAL_LOCATION),
    foreground: liveForeground(liveEntry),
  };
}

// ── Endpoint implementation ────────────────────────────────────────────

class LocalTerminalEndpoint implements TerminalEndpoint {
  readonly fs = localFs;
  readonly git = localGit;

  /** id → its providers + tap-bridge teardown. Its keys ARE the terminals
   *  with a live provider layer in this process. */
  private readonly lifecycles = new Map<TerminalId, TerminalLifecycle>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    // Sync shadow: register a connecting entry (proxy handle + default
    // metadata) so the tile renders immediately — the `TerminalEndpoint.
    // spawnPty` sync-shadow contract. The pty-host resolves the authoritative
    // cwd / pid on the async tail below; the providers start there too.
    //
    // The shadow only needs a placeholder cwd until the spawn echoes back the
    // resolved value (`res.cwd` at the `spawnAndWire` tail). We deliberately do
    // NOT re-derive a home-dir fallback here: that would be a second rule for
    // the same value that can disagree with the spawn's own fallback chain
    // (`buildTerminalSpawnInput`, which can consult the host's `info.home` that
    // this synchronous path cannot see). Seed with the caller's cwd or empty,
    // and let the `res.cwd` correction below install the single authority.
    const cwd = opts.cwd ?? "";
    const proxy = new PtyHostTerminalProxy(id, ptyHostClient);
    const meta: TerminalMetadata = { ...createMetadata(cwd, LOCAL_LOCATION) };
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.intent) meta.intent = initial.intent;
    if (initial?.lastActivityAt !== undefined)
      meta.lastActivityAt = initial.lastActivityAt;

    const entry: TerminalProcess = {
      info: { id, pid: 0 },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    emitTerminalsDirty();
    emitTerminalListChanged();

    void this.spawnAndWire(id, opts, proxy, entry, tlog);
    return entry.info;
  }

  /** Adopt a SURVIVING PTY (B3.3): the kaval daemon outlived a kolu-server
   *  restart, so its PTY for `id` is already alive at `liveEntry.pid`.
   *  Re-establish kolu's side WITHOUT spawning — register the terminal under the
   *  caller-built `meta` (a whole saved record via `adoptedMeta`, or an orphan's
   *  live-snapshot defaults via `orphanMeta`; either way the live fields
   *  pr/agent/foreground are re-derived by the providers, the freshness
   *  guarantee), release the handle at the live pid, and re-run the providers
   *  against the surviving taps. The sibling of `spawnPty`/`spawnAndWire` minus
   *  the spawn RPC: both converge on `startProviderLayer`, and a wiring failure
   *  reaps the orphaned PTY through the shared `killHalfWiredPty`. */
  adoptTerminal(
    id: TerminalId,
    meta: TerminalMetadata,
    liveEntry: PtyHostListEntry,
  ): void {
    const tlog = log.child({ terminal: id });
    const proxy = new PtyHostTerminalProxy(id, ptyHostClient);
    const entry: TerminalProcess = {
      info: { id, pid: liveEntry.pid },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    // The PTY already exists on the survivor — release the handle's queued /
    // awaited verbs at the live pid with no spawn RPC (the sole structural
    // difference from `spawnAndWire`).
    proxy.markReady(liveEntry.pid);
    try {
      this.startProviderLayer(id, entry, liveEntry.pid);
    } catch (err) {
      // Provider wiring failed against the survivor — the same reap policy as a
      // failed fresh spawn (the F2 receptacle): tear down partials, kill the
      // now-orphaned PTY, unwind the entry.
      this.killHalfWiredPty(
        id,
        tlog,
        err,
        "provider wiring failed while adopting a surviving PTY; killing the orphan",
      );
      return;
    }
    // Refresh the live `terminalList` cell so the client renders the adopted
    // tile. Deliberately NO `emitTerminalsDirty()`: the saved session already
    // holds this terminal, and the boot converges the session explicitly once
    // all survivors are adopted — arming an autosave here could persist a
    // half-adopted set (or a not-yet-restored active marker).
    emitTerminalListChanged();
    tlog.info({ pid: liveEntry.pid }, "adopted surviving PTY");
  }

  /** The pty-host spawn RPC + the killed-during-spawn race check. Returns the
   *  resolved `{pid, cwd}`, or null if the terminal was killed while the RPC
   *  was in flight (the pty-host-side PTY is then cleaned up here). Throws on
   *  an RPC failure — the caller (`spawnAndWire`) unwinds the shadow. */
  private async spawnViaClient(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
  ): Promise<{ pid: number; cwd: string } | null> {
    const res = await ptyHostClient.surface.terminal.spawn(
      await buildTerminalSpawnInput({ id, cwd: opts.cwd }),
    );
    if (!getTerminal(id)) {
      proxy.markFailed(new Error("terminal killed during spawn"));
      try {
        await ptyHostClient.surface.terminal.kill({ id });
      } catch (err) {
        log
          .child({ terminal: id })
          .error({ err }, "pty-host kill of spawn-raced terminal failed");
      }
      return null;
    }
    return { pid: res.pid, cwd: res.cwd };
  }

  /** Async tail of `spawnPty`: confirm the PTY spawned, then start the
   *  providers against its taps. On failure unwinds the shadow. */
  private async spawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    entry: TerminalProcess,
    tlog: typeof log,
  ): Promise<void> {
    // Phase 1 — the spawn RPC. A failure here means no PTY was created
    // (`host.spawn` either returns a live child or throws), so there's nothing
    // to kill: just unwind the sync shadow.
    let res: { pid: number; cwd: string } | null;
    try {
      res = await this.spawnViaClient(id, opts, proxy);
    } catch (err) {
      tlog.error({ err }, "pty-host terminal.spawn failed");
      proxy.markFailed(err);
      this.unwindSpawnShadow(id);
      return;
    }
    if (!res) return; // killed during spawn — spawnViaClient already cleaned up

    proxy.markReady(res.pid);
    entry.info.pid = res.pid;
    // Seed the authoritative resolved cwd before starting the providers (the git
    // watcher reads `record.meta.cwd` at start).
    updateServerMetadata(entry, id, (m) => {
      m.cwd = res.cwd;
    });

    // Phase 2 — post-spawn wiring. The PTY now exists and the host owns it, so
    // a failure here must KILL the child (not just unregister the entry), or
    // we leak an orphaned PTY with no server-side record.
    try {
      this.startProviderLayer(id, entry, res.pid);
    } catch (err) {
      this.killHalfWiredPty(
        id,
        tlog,
        err,
        "pty-host provider wiring failed after spawn; killing the orphaned PTY",
      );
      return;
    }
    tlog.info({ pid: res.pid, total: listTerminals().length }, "created");
    emitTerminalListChanged();
  }

  /** Drop a sync-shadow entry whose async spawn/wiring failed (idempotent). */
  private unwindSpawnShadow(id: TerminalId): void {
    if (!getTerminal(id)) return;
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  /** Recover from "the PTY exists on the daemon but provider wiring failed":
   *  log the wiring error under `reason`, tear down any partial providers, kill
   *  the orphaned PTY (a kill failure is logged, not thrown — there's nothing
   *  left to do), and unwind the sync shadow. Extracted as the one reap policy
   *  so B3.3's survivor-adoption path can share it — one place to change how a
   *  half-wired PTY is reaped; `reason` distinguishes the call site. */
  private killHalfWiredPty(
    id: TerminalId,
    tlog: typeof log,
    err: unknown,
    reason: string,
  ): void {
    tlog.error({ err }, reason);
    this.teardownProviders(id);
    void ptyHostClient.surface.terminal
      .kill({ id })
      .catch((killErr) =>
        tlog.error({ err: killErr }, "kill of half-wired PTY failed"),
      );
    this.unwindSpawnShadow(id);
  }

  /** Wire one terminal's awareness from the pty-host's tap streams. The
   *  in-server foreground/process observer runs HERE (no filesystem); the
   *  host-side git / PR / agent providers run behind `buildWatcherServer`,
   *  driven over `directLink`. Either way the providers are the current build's
   *  code, never riding the long-lived pty-host (the freshness guarantee). */
  private startProviderLayer(
    id: TerminalId,
    entry: TerminalProcess,
    pid: number,
  ): void {
    const abort = new AbortController();
    const { signal } = abort;
    const record: ProviderRecord = {
      pid,
      meta: entry.meta,
      currentAgent: null,
    };

    // Begin watching the host-side providers. Fire-and-forget: the signal
    // relays + awareness subscribe below tolerate it resolving on a later
    // microtask, and `watch` resolves before any tap event (a tap awaits its
    // stream first). `record.meta.cwd` is the spawn-time cwd the providers read
    // once.
    const watched = watcherClient.surface.terminal.watch({
      id,
      pid,
      cwd: record.meta.cwd,
    });
    watched.catch((err) =>
      log.error({ err, terminal: id }, "watcher: watch failed"),
    );

    // The in-server foreground/process observer (no filesystem — the note's
    // split). It consumes only the foreground + title channels (the host-side
    // providers consume the relayed signals over the link), so we build exactly
    // those two — its narrowed parameter type makes the omission honest.
    const inServerChannels = {
      title: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
    };
    const stopProcess = startProcessProvider(
      record,
      id,
      inServerChannels,
      makeInServerHooks(entry, id),
    );

    // Bridge the raw VT taps. cwd lands on persisted metadata in-server (the
    // bridge owns `m.cwd`); every tap also relays to the host-side providers as
    // a `signal.*` call, and foreground/title additionally feed the in-server
    // process observer.
    bridgeStream(
      ptyHostClient.surface.cwd.get({ id }, { signal }),
      signal,
      (msg) => {
        updateServerMetadata(entry, id, (m) => {
          m.cwd = msg.cwd;
        });
        pushSignal(watcherClient.surface.signal.cwd({ id, cwd: msg.cwd }), id);
      },
    );
    bridgeStream(
      ptyHostClient.surface.title.get({ id }, { signal }),
      signal,
      (msg) => {
        inServerChannels.title.publish(msg.title);
        pushSignal(
          watcherClient.surface.signal.title({ id, title: msg.title }),
          id,
        );
      },
    );
    bridgeStream(
      ptyHostClient.surface.commandRun.get({ id }, { signal }),
      signal,
      (msg) =>
        pushSignal(
          watcherClient.surface.signal.commandRun({ id, command: msg.command }),
          id,
        ),
    );
    bridgeStream(
      ptyHostClient.surface.foreground.get({ id }, { signal }),
      signal,
      (msg) => {
        inServerChannels.foreground.publish({
          process: msg.process,
          foregroundPid: msg.foregroundPid,
        });
        pushSignal(
          watcherClient.surface.signal.foreground({
            id,
            process: msg.process,
            foregroundPid: msg.foregroundPid,
          }),
          id,
        );
      },
    );

    // Fold the host-side providers' awareness back onto the terminal's metadata,
    // split along the same persisted-vs-live write fence `metadata.ts` enforces
    // — so live churn (pr polls, agent stream sub-info) never fires
    // `terminals:dirty`. Subscribed after `watch` resolves, so the collection
    // `get` reads a valid seeded snapshot first, then deltas.
    void (async () => {
      try {
        await watched;
      } catch {
        return; // watch failed — already logged; nothing to fold
      }
      if (signal.aborted) return;
      bridgeStream(
        watcherClient.surface.persistedAwareness.get({ key: id }, { signal }),
        signal,
        (a) =>
          updateServerMetadata(entry, id, (m) => {
            m.git = a.git;
            m.lastAgentCommand = a.lastAgentCommand;
            m.lastActivityAt = a.lastActivityAt;
          }),
      );
      bridgeStream(
        watcherClient.surface.liveAwareness.get({ key: id }, { signal }),
        signal,
        (a) =>
          updateServerLiveMetadata(entry, id, (m) => {
            m.pr = a.pr;
            m.agent = a.agent;
          }),
      );
    })();

    // Natural exit: the `exit` tap yields the code once. An intentional kill
    // aborts this signal first (see `teardownProviders`), so `handleExit` only
    // ever fires for a genuine exit.
    bridgeStream(
      ptyHostClient.surface.exit.get({ id }, { signal }),
      signal,
      (msg) => this.handleExit(id, msg.exitCode),
      (err) => {
        // The exit tap is the terminal's lifecycle signal — losing it is not
        // a missing field, it's "we no longer know when this PTY dies." In
        // process the stream only ends via the exit code or an abort
        // (teardown), so a non-abort failure is unreachable today; this fires
        // only once pty-host is socket-served. The correct recovery there is
        // to RE-SUBSCRIBE (the surviving daemon may still own a live PTY) —
        // tearing the terminal down here would be the #1034 premature-loss
        // bug, and leaving it silent is the stale-terminal mode. That
        // reconnect is mid-session resilience (R-3); until it lands, surface
        // the lost signal loudly rather than swallow it as a generic tap drop.
        log.error(
          { err, terminal: id },
          "pty-host exit tap failed (non-abort) — exit signal lost; terminal may be stale until R-3 wires re-subscribe",
        );
      },
    );

    this.lifecycles.set(id, {
      abort,
      stopProviders: () => {
        stopProcess();
        void watcherClient.surface.terminal
          .unwatch({ id })
          .catch((err) =>
            log.error({ err, terminal: id }, "watcher: unwatch failed"),
          );
      },
    });
  }

  /** Stop a terminal's providers + tap bridges (idempotent). Aborting the
   *  signal ends every tap subscription — including the `exit` tap, so a kill
   *  that calls this BEFORE the pty-host kill can't trip `handleExit`. */
  private teardownProviders(id: TerminalId): void {
    const lc = this.lifecycles.get(id);
    if (!lc) return;
    this.lifecycles.delete(id);
    lc.abort.abort();
    lc.stopProviders();
  }

  /** A terminal's PTY exited naturally. Stop its provider layer, publish the
   *  exit, drop the entry, save the session. */
  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    this.teardownProviders(id);
    cleanupTerminalScratch(id);
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  async killTerminal(id: TerminalId): Promise<TerminalInfo | undefined> {
    const entry = getTerminal(id);
    if (!entry) return undefined;
    const tlog = log.child({ terminal: id });
    tlog.info({ pid: entry.info.pid }, "killing");
    // Stop the provider layer FIRST — this aborts the `exit` tap, so the
    // pty-host's exit (which fires on an intentional kill too, since pty-host
    // makes no kill/exit distinction) can't reach `handleExit` and
    // double-publish `terminalExit`. The kill RPC's response drives client
    // cleanup instead.
    this.teardownProviders(id);
    try {
      await ptyHostClient.surface.terminal.kill({ id });
    } catch (err) {
      tlog.error({ err }, "pty-host kill failed; unregistering anyway");
    }
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    return entry.info;
  }

  async killAllTerminals(): Promise<void> {
    const ids = listTerminals().map((info) => info.id);
    log.info({ count: ids.length }, "killing all terminals");
    for (const id of ids) this.teardownProviders(id);
    try {
      await ptyHostClient.surface.terminal.killAll({});
    } catch (err) {
      log.error({ err }, "pty-host killAll failed; draining anyway");
    }
    const entries = drainTerminals();
    for (const entry of entries) cleanupTerminalScratch(entry.info.id);
    emitTerminalListChanged();
  }

  async attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
  ): Promise<TerminalAttachment> {
    // Wait for the PTY to actually exist before opening the attach stream —
    // otherwise a tile attaching off the sync shadow races the in-flight
    // `terminal.spawn` and the pty-host throws "no PTY with id". `ready` is the
    // `TerminalHandle` invariant (undefined ⟹ already live); awaiting it
    // surfaces a spawn failure rather than hitting a missing PTY.
    await getTerminal(id)?.handle.ready;
    const stream = await ptyHostClient.surface.terminalAttach.get(
      { id },
      { signal },
    );
    const iter = stream[Symbol.asyncIterator]();
    // The pty-host contract guarantees the first frame is the screen-state
    // snapshot, then deltas. A first frame that isn't a snapshot is a contract
    // violation — throw rather than silently paint a blank terminal (the same
    // fail-loud stance as `getScreenState`'s NOT_FOUND).
    const first = await iter.next();
    let snapshot = "";
    if (!first.done) {
      if (first.value.kind !== "snapshot") {
        throw new Error(
          `attach(${id}): expected a snapshot first frame, got "${first.value.kind}"`,
        );
      }
      snapshot = first.value.data;
    }
    const deltas = (async function* () {
      if (first.done) return;
      // `iter` is an AsyncIterator, not AsyncIterable — wrap it so `for await`
      // can consume the already-advanced iterator (after the snapshot was read).
      for await (const msg of { [Symbol.asyncIterator]: () => iter }) {
        yield msg.data;
      }
    })();
    return { snapshot, deltas };
  }
}

const localEndpointImpl = new LocalTerminalEndpoint();
export const localTerminalEndpoint: TerminalEndpoint = localEndpointImpl;

/** Adopt a surviving local PTY at boot (B3.3) that HAS a saved record — its
 *  persisted chrome rides through whole (`adoptedMeta`), with the live daemon
 *  snapshot the authority for `cwd`/`foreground`. Exposed as a standalone entry
 *  rather than on the shared `TerminalEndpoint` interface because adoption
 *  is local-only today — P3's remote-host adoption is an additive sibling, not
 *  a retrofit of the shared interface. */
export function adoptLocalTerminal(
  record: SavedTerminal,
  liveEntry: PtyHostListEntry,
): void {
  localEndpointImpl.adoptTerminal(
    record.id as TerminalId,
    adoptedMeta(record, liveEntry),
    liveEntry,
  );
}

/** Adopt a surviving local PTY at boot (B3.3) that has NO saved record (F1) — a
 *  create that never reached the debounced autosave before the restart. The live
 *  shell is adopted (never reaped), seeded entirely from the daemon snapshot
 *  (`orphanMeta`). The sibling of `adoptLocalTerminal` for the unmatched-survivor
 *  case the reconcile partition surfaces separately. */
export function adoptLocalOrphan(liveEntry: PtyHostListEntry): void {
  localEndpointImpl.adoptTerminal(
    liveEntry.id as TerminalId,
    orphanMeta(liveEntry),
    liveEntry,
  );
}
