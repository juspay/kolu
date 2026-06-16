/**
 * `LocalTerminalEndpoint` — this kolu process. It does **not** own `kaval`:
 * `kolu-server` is a client of a separately spawned kaval daemon, and reaches
 * it through the typed `ptyHostSurface` contract via the stable `ptyHostClient`
 * forwarding facade (`../ptyHost/index.ts`) over that daemon's own socket. This
 * endpoint forwards spawn/kill/write/resize/attach through that client AND
 * **runs the per-terminal provider DAG** (`./providers.ts`) against the
 * pty-host's raw tap streams (cwd · title · command-run · foreground).
 *
 * Why route through the contract rather than call `PtyHost` directly: the
 * consumer here is then written against `PtyHostClient` — the exact shape the
 * daemon (over a unix socket) or a remote ssh pty-host serves. The provider DAG
 * has zero synchronous dependency on the host (it reads taps, not a
 * `PtyHandle`), so it runs identically across the wire. The kaval daemon serves
 * its own socket, which `kaval-tui` reaches directly — a second consumer of the
 * one host, and nothing in this file changes for it. See
 * `docs/atlas/src/content/atlas/pty-daemon.mdx` (Fresh approach).
 *
 * `TerminalEndpoint.fs/git` stay on this side — the local surfaces shell out to
 * `kolu-git` directly; a remote endpoint (P3) mirrors the same surfaces over the
 * link.
 */

import type { ForegroundSample, PtyHostClient, PtyHostListEntry } from "kaval";
import { inMemoryChannel } from "@kolu/surface/server";
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
  TerminalHandle,
} from "kolu-common/terminalEndpoint";
import type { GitInfo } from "kolu-git/schemas";
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
import {
  createMetadata,
  updateServerLiveMetadata,
  updateServerMetadata,
} from "./metadata.ts";
import {
  makeFsGit,
  type ProviderChannels,
  type ProviderHooks,
  type ProviderRecord,
  startProviders,
} from "@kolu/terminal-dag";

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
// The fs/git adapter is shared with kolu-watcher (P3) via `@kolu/terminal-dag`
// so both read a host's real filesystem through ONE kolu-git impl — see
// `makeFsGit`. The only difference local vs remote is which process runs it.

const { fs: localFs, git: localGit } = makeFsGit(log);

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

/** Wire the provider hooks to kolu-server's metadata + activity surfaces.
 *  `record.meta` IS `entry.meta` (same object), so a provider mutating its
 *  record is publishing kolu-server state directly. */
function makeHooks(entry: TerminalProcess, id: TerminalId): ProviderHooks {
  return {
    log,
    updateServerMetadata: (_record, mutate) =>
      updateServerMetadata(entry, id, mutate),
    updateServerLiveMetadata: (_record, mutate) =>
      updateServerLiveMetadata(entry, id, mutate),
    trackRecentRepo,
    trackRecentAgent,
    // The screen-scrape promoter (Claude's AskUserQuestion / ExitPlanMode, #905)
    // reads the rendered screen through the pty-host handle. `getScreenText`
    // waits on `ready`, so it's safe even if a poll tick races spawn. The
    // promoter passes its detector's `tailLines` so only the screen bottom is
    // read — not the full (up to 50k-line) scrollback — each poll.
    readScreenText: (tailLines) =>
      entry.handle.getScreenText(undefined, undefined, tailLines),
  };
}

/** Everything needed to stop one terminal's provider DAG + tap bridges: abort
 *  the tap-stream subscriptions and stop the watchers. */
interface TerminalLifecycle {
  abort: AbortController;
  stopProviders: () => void;
}

/** Best-effort `foreground` seed from a live `list` entry's `foregroundProcess`
 *  (contract 2.1). The provider DAG re-derives the authoritative value from the
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
    ...createMetadata(liveEntry.cwd),
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
    ...createMetadata(liveEntry.cwd),
    foreground: liveForeground(liveEntry),
  };
}

// ── Endpoint implementation ────────────────────────────────────────────

class LocalTerminalEndpoint implements TerminalEndpoint {
  readonly fs = localFs;
  readonly git = localGit;

  /** id → its provider-DAG + tap-bridge teardown. Its keys ARE the terminals
   *  with a live provider layer in this process. */
  private readonly lifecycles = new Map<TerminalId, TerminalLifecycle>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    const tlog = log.child({ terminal: id });

    // Sync shadow: register a connecting entry (proxy handle + default
    // metadata) so the tile renders immediately — the `TerminalEndpoint.
    // spawnPty` sync-shadow contract. The pty-host resolves the authoritative
    // cwd / pid on the async tail below; the provider DAG starts there too.
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
    const meta: TerminalMetadata = { ...createMetadata(cwd) };
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
   *  guarantee), release the handle at the live pid, and re-run the provider DAG
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
   *  provider DAG against its taps. On failure unwinds the shadow. */
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
    // Seed the authoritative resolved cwd before starting the DAG (the git
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

  /** Start the per-terminal provider DAG against the pty-host's tap streams.
   *  The DAG runs HERE, in kolu-server, so it's always the current build's
   *  code (the freshness guarantee — the most-edited code never rides the
   *  long-lived pty-host). */
  private startProviderLayer(
    id: TerminalId,
    entry: TerminalProcess,
    pid: number,
  ): void {
    const abort = new AbortController();
    const { signal } = abort;
    const channels: ProviderChannels = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
      git: inMemoryChannel<GitInfo | null>(),
    };
    const record: ProviderRecord = {
      pid,
      meta: entry.meta,
      currentAgent: null,
    };
    const hooks = makeHooks(entry, id);

    // Bridge the raw VT taps onto the provider channels. cwd also lands on
    // persisted metadata (the bridge owns `m.cwd`; the git provider reads
    // `channels.cwd` to re-resolve git).
    bridgeStream(
      ptyHostClient.surface.cwd.get({ id }, { signal }),
      signal,
      (msg) => {
        updateServerMetadata(entry, id, (m) => {
          m.cwd = msg.cwd;
        });
        channels.cwd.publish(msg.cwd);
      },
    );
    bridgeStream(
      ptyHostClient.surface.title.get({ id }, { signal }),
      signal,
      (msg) => channels.title.publish(msg.title),
    );
    bridgeStream(
      ptyHostClient.surface.commandRun.get({ id }, { signal }),
      signal,
      (msg) => channels.commandRun.publish(msg.command),
    );
    bridgeStream(
      ptyHostClient.surface.foreground.get({ id }, { signal }),
      signal,
      (msg) =>
        channels.foreground.publish({
          process: msg.process,
          foregroundPid: msg.foregroundPid,
        }),
    );
    const stopProviders = startProviders(record, id, channels, hooks);

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

    this.lifecycles.set(id, { abort, stopProviders });
  }

  /** Stop a terminal's provider DAG + tap bridges (idempotent). Aborting the
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
