/**
 * `LocalTerminalEndpoint` — this kolu process. It does **not** own `kaval`:
 * `kolu-server` is a client of a separately spawned kaval daemon, and reaches
 * it through the typed `ptyHostSurface` contract via the stable `ptyHostClient`
 * forwarding facade (`../ptyHost/index.ts`) over that daemon's own socket. This
 * endpoint forwards spawn/kill/write/resize/attach through that client AND
 * **runs the per-terminal sensor set** (`@kolu/terminal-awareness`) against the
 * pty-host's raw tap streams (cwd · title · command-run · foreground).
 *
 * Why route through the contract rather than call `PtyHost` directly: the
 * consumer here is then written against `PtyHostClient` — the exact shape the
 * daemon (over a unix socket) or a remote ssh pty-host serves. The sensor set
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

import { inMemoryChannel } from "@kolu/surface/server";
import {
  type AwarenessRecord,
  type AwarenessSignals,
  type AwarenessSink,
  startAwareness,
} from "@kolu/terminal-awareness";
import { resumeFormFor } from "anyagent/cli";
import type { ForegroundSample, PtyHostClient, PtyHostListEntry } from "kaval";
import type {
  ActiveTerminal,
  SavedActiveTerminal,
  SavedSleepingTerminal,
  SleepingTerminal,
  TerminalId,
  TerminalInfo,
} from "kolu-common/surface";
import {
  LOCAL_LOCATION,
  SavedSleepingTerminalSchema,
  SleepingTerminalSchema,
  TerminalIdSchema,
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
  type ActiveTerminalProcess,
  drainTerminals,
  getActiveTerminal,
  getTerminal,
  listTerminals,
  registerTerminal,
  type SleepingTerminalProcess,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { cleanupTerminalScratch } from "../terminalScratch.ts";
import { unwrapGit } from "../unwrapGit.ts";
import {
  createMetadata,
  publishTerminalState,
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
 *  pid — the live reads (cwd / process / foregroundPid) the sensors need
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

// ── Per-terminal sensor bridge ───────────────────────────────────────

/** Pump a pty-host tap stream into a callback until it ends or `signal` aborts
 *  (kill / exit). The contract stream call resolves to the async iterable (a
 *  `ClientPromiseResult`), so the source is awaited first. An aborted stream
 *  surfaces as a thrown error, so an aborted signal is treated as expected
 *  teardown, not a failure.
 *
 *  Returns a Promise that resolves when the stream ends or aborts (it never
 *  rejects — failures are logged / routed to `onError`). The per-terminal taps
 *  ignore it (fire-and-forget); the inventory reconciler awaits it to know when
 *  to re-subscribe across a daemon recycle. */
export function bridgeStream<T>(
  source: AsyncIterable<T> | PromiseLike<AsyncIterable<T>>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  // Called when the stream itself fails for a NON-abort reason (an abort is
  // expected teardown and is always swallowed). Enrichment taps (cwd / title /
  // command-run / foreground) omit it — a dropped enrichment stream just stops
  // updating that field, logged generically. The exit tap supplies one because
  // a dropped *exit* stream is a lifecycle problem, not a missing field.
  onError?: (err: unknown) => void,
): Promise<void> {
  return (async () => {
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

/** Wire the awareness sink to kolu-server's metadata + activity surfaces.
 *  `record.meta` IS `entry.meta` (same object), so a sensor mutating its
 *  record is publishing kolu-server state directly. */
function makeAwarenessSink(
  entry: ActiveTerminalProcess,
  id: TerminalId,
): AwarenessSink {
  return {
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

/** Everything needed to stop one terminal's sensor set + tap bridges: abort
 *  the tap-stream subscriptions and stop the watchers. */
interface TerminalLifecycle {
  abort: AbortController;
  stopAwareness: () => void;
}

/** Best-effort `foreground` seed from a live `list` entry's `foregroundProcess`
 *  (contract 2.1). The sensor set re-derives the authoritative value from the
 *  surviving foreground tap (which replays a snapshot on subscribe), so this is
 *  only the pre-tap value the tile renders for the boot frame — null when the
 *  daemon reports no foreground name. `title` is unknown to the foreground field,
 *  so it stays null until the title tap fires. */
function liveForeground(
  liveEntry: PtyHostListEntry,
): ActiveTerminal["foreground"] {
  return liveEntry.foregroundProcess
    ? { name: liveEntry.foregroundProcess, title: liveEntry.title ?? null }
    : null;
}

/** The whole-record adoption mapping (B3.3): a `SavedActiveTerminal`'s persisted
 *  fields become a live `ActiveTerminal` as a UNIT — `createMetadata` seeds the
 *  live-field defaults (pr/agent re-derived by the sensors against the
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
 *  live truth. The survivor's listed `cwd` wins; the git sensor re-resolves
 *  against it on start. */
export function adoptedMeta(
  record: SavedActiveTerminal,
  liveEntry: PtyHostListEntry,
): ActiveTerminal {
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
 *  the live daemon snapshot. Client-persisted chrome (theme/layout/notes) that
 *  never made it to disk is gone, but the live shell and its scrollback survive,
 *  which is the headline guarantee; the sensors re-derive git/agent/pr from the
 *  surviving taps. */
export function orphanMeta(liveEntry: PtyHostListEntry): ActiveTerminal {
  return {
    ...createMetadata(liveEntry.cwd, LOCAL_LOCATION),
    foreground: liveForeground(liveEntry),
  };
}

/** The WAKE mapping — the inverse of the sleeping flip: a sleeping terminal's
 *  persisted base becomes a fresh live `ActiveTerminal`. `createMetadata` seeds
 *  the live-field defaults (pr/agent/foreground re-derived by the sensors on the
 *  re-spawned PTY), then the persisted base is spread WHOLE — theme, layout,
 *  notes, git, and crucially `lastAgentCommand` all ride through, never
 *  reconstructed field-by-field (the #1275 lossy class, and the BUG-B class that
 *  stripped the agent on the discarded first cut) — and `state` flips to active.
 *  Pure + exported so a schema-key round-trip test pins that no persisted key is
 *  dropped on wake. The `location` rides the base, so a future remote terminal
 *  wakes against its own host. */
export function wakeMeta(sleeping: SleepingTerminal): ActiveTerminal {
  // Drop the sleeping-only discriminant fields (`sleptAt` and the frozen `pr`
  // snapshot) so neither rides onto the active arm — the active arm never carries
  // `sleptAt`, and the live `pr` is re-resolved by the re-spawned PTY's sensor
  // (`createMetadata` re-seeds it to `{ kind: "pending" }`), so the stale snapshot
  // must NOT ride back over that fresh resolution.
  const { state: _state, sleptAt: _sleptAt, pr: _pr, ...persisted } = sleeping;
  return {
    ...createMetadata(persisted.cwd, persisted.location),
    ...persisted,
    state: "active",
  };
}

// ── Endpoint implementation ────────────────────────────────────────────

class LocalTerminalEndpoint implements TerminalEndpoint {
  readonly fs = localFs;
  readonly git = localGit;

  /** id → its sensor-set + tap-bridge teardown. Its keys ARE the terminals
   *  with a live sensor layer in this process. */
  private readonly lifecycles = new Map<TerminalId, TerminalLifecycle>();

  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo {
    // Sync shadow: register a connecting entry (proxy handle + default
    // metadata) so the tile renders immediately — the `TerminalEndpoint.
    // spawnPty` sync-shadow contract. The pty-host resolves the authoritative
    // cwd / pid on the async tail below; the sensor set starts there too.
    //
    // The shadow only needs a placeholder cwd until the spawn echoes back the
    // resolved value (`res.cwd` at the `spawnAndWire` tail). We deliberately do
    // NOT re-derive a home-dir fallback here: that would be a second rule for
    // the same value that can disagree with the spawn's own fallback chain
    // (`buildTerminalSpawnInput`, which can consult the host's `info.home` that
    // this synchronous path cannot see). Seed with the caller's cwd or empty,
    // and let the `res.cwd` correction below install the single authority.
    const cwd = opts.cwd ?? "";
    const meta: ActiveTerminal = { ...createMetadata(cwd, LOCAL_LOCATION) };
    if (opts.parentId) meta.parentId = opts.parentId;
    const initial = opts.initialMetadata;
    if (initial?.themeName) meta.themeName = initial.themeName;
    if (initial?.canvasLayout) meta.canvasLayout = initial.canvasLayout;
    if (initial?.subPanel) meta.subPanel = initial.subPanel;
    if (initial?.rightPanel) meta.rightPanel = initial.rightPanel;
    if (initial?.notes) meta.notes = initial.notes;
    if (initial?.lastActivityAt !== undefined)
      meta.lastActivityAt = initial.lastActivityAt;

    return this.registerActiveAndSpawn(id, meta, opts);
  }

  /** Register a fresh ACTIVE sync-shadow entry under `id` (proxy handle + the
   *  given `meta`) and kick off its async spawn + sensor wiring. The shared core
   *  of `spawnPty` (createMetadata-seeded) and `wake` (sleeping-base-preserved):
   *  both register a live entry then spawn, differing only in the `meta` carried
   *  in and whether `opts.resumeCommand` replays an agent on the freshly-spawned
   *  PTY.
   *
   *  Captures the entry this active shadow OVERWRITES (`prior`) and threads it
   *  into the spawn tail so a wake whose spawn/wiring fails can RESTORE the
   *  sleeping record rather than drop it (F2): `wake` overwrites a sleeping
   *  entry, and unconditionally unregistering on failure would erase the dormant
   *  record the user can still wake (and the next autosave would persist that
   *  loss). A fresh `spawnPty` overwrites nothing, so `prior` is undefined and
   *  the unwind is a plain unregister as before. */
  private registerActiveAndSpawn(
    id: TerminalId,
    meta: ActiveTerminal,
    opts: PtySpawnOpts,
  ): TerminalInfo {
    const tlog = log.child({ terminal: id });
    const prior = getTerminal(id);
    const proxy = new PtyHostTerminalProxy(id, ptyHostClient);
    const entry: ActiveTerminalProcess = {
      info: { id, pid: 0 },
      meta,
      handle: proxy,
    };
    registerTerminal(id, entry);
    emitTerminalsDirty();
    emitTerminalListChanged();

    void this.spawnAndWire(id, opts, proxy, entry, prior, tlog);
    return entry.info;
  }

  /** Adopt a SURVIVING PTY (B3.3): the kaval daemon outlived a kolu-server
   *  restart, so its PTY for `id` is already alive at `liveEntry.pid`.
   *  Re-establish kolu's side WITHOUT spawning — register the terminal under the
   *  caller-built `meta` (a whole saved record via `adoptedMeta`, or an orphan's
   *  live-snapshot defaults via `orphanMeta`; either way the live fields
   *  pr/agent/foreground are re-derived by the sensors, the freshness
   *  guarantee), release the handle at the live pid, and re-run the sensor set
   *  against the surviving taps. The sibling of `spawnPty`/`spawnAndWire` minus
   *  the spawn RPC: both converge on `startAwarenessSensors`, and a wiring failure
   *  reaps the orphaned PTY through the shared `killHalfWiredPty`. */
  adoptTerminal(
    id: TerminalId,
    meta: ActiveTerminal,
    liveEntry: PtyHostListEntry,
  ): void {
    const tlog = log.child({ terminal: id });
    const proxy = new PtyHostTerminalProxy(id, ptyHostClient);
    const entry: ActiveTerminalProcess = {
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
      this.startAwarenessSensors(id, entry, liveEntry.pid);
    } catch (err) {
      // Sensor wiring failed against the survivor — the same reap policy as a
      // failed fresh spawn (the F2 receptacle): tear down partials, kill the
      // now-orphaned PTY, unwind the entry. Adoption overwrites no prior record
      // (a survivor is registered fresh at boot), so there is nothing to
      // restore — `prior` is undefined and the unwind is a plain unregister.
      this.killHalfWiredPty(
        id,
        entry,
        undefined,
        tlog,
        err,
        "sensor wiring failed while adopting a surviving PTY; killing the orphan",
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

  /** The pty-host spawn RPC + the raced-during-spawn check. Returns the resolved
   *  `{pid, cwd}`, or null if the registry's active entry for `id` is no longer
   *  the one this spawn is wiring — killed, slept, or re-spawned while the RPC was
   *  in flight (the pty-host-side PTY is then cleaned up here). Throws on an RPC
   *  failure — the caller (`spawnAndWire`) unwinds the shadow.
   *
   *  The check is by IDENTITY (`getActiveTerminal(id) === expected`), not mere
   *  presence (F1): a `beginSleep` that flipped the entry to sleeping mid-spawn
   *  leaves a DIFFERENT entry under the same id, so a bare presence check would
   *  pass and the tail would wire sensors + republish active metadata over the
   *  sleeping flip — leaking a hidden live PTY the registry believes is dormant.
   *  A mismatch leaves the registry ALONE (it now holds someone else's entry —
   *  the sleeping flip, or a fresh re-spawn) and only kills the orphaned PTY. */
  private async spawnViaClient(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    expected: ActiveTerminalProcess,
  ): Promise<{ pid: number; cwd: string } | null> {
    const res = await ptyHostClient.surface.terminal.spawn(
      await buildTerminalSpawnInput({ id, cwd: opts.cwd }),
    );
    if (getActiveTerminal(id) !== expected) {
      proxy.markFailed(new Error("terminal raced during spawn (killed/slept)"));
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

  /** Async tail of `spawnPty`/`wake`: confirm the PTY spawned, then start the
   *  sensor set against its taps. On failure unwinds the shadow, restoring a
   *  `prior` sleeping entry on a wake (F2). */
  private async spawnAndWire(
    id: TerminalId,
    opts: PtySpawnOpts,
    proxy: PtyHostTerminalProxy,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
    tlog: typeof log,
  ): Promise<void> {
    // Phase 1 — the spawn RPC. A failure here means no PTY was created
    // (`host.spawn` either returns a live child or throws), so there's nothing
    // to kill: just unwind the sync shadow.
    let res: { pid: number; cwd: string } | null;
    try {
      res = await this.spawnViaClient(id, opts, proxy, entry);
    } catch (err) {
      tlog.error({ err }, "pty-host terminal.spawn failed");
      proxy.markFailed(err);
      this.unwindSpawnShadow(id, entry, prior);
      return;
    }
    if (!res) return; // raced during spawn — spawnViaClient already cleaned up

    proxy.markReady(res.pid);
    entry.info.pid = res.pid;
    // Seed the authoritative resolved cwd before starting the sensor set (the git
    // watcher reads `record.meta.cwd` at start).
    updateServerMetadata(entry, id, (m) => {
      m.cwd = res.cwd;
    });

    // Phase 2 — post-spawn wiring. The PTY now exists and the host owns it, so
    // a failure here must KILL the child (not just unregister the entry), or
    // we leak an orphaned PTY with no server-side record.
    try {
      this.startAwarenessSensors(id, entry, res.pid);
    } catch (err) {
      this.killHalfWiredPty(
        id,
        entry,
        prior,
        tlog,
        err,
        "pty-host sensor wiring failed after spawn; killing the orphaned PTY",
      );
      return;
    }
    // WAKE: replay the agent as type-ahead now that the sensor set is wired, so
    // the command-run tap catches the resumed invocation and the agent indicator
    // re-lights. The PTY buffers the bytes until the shell reaches its prompt
    // (the same type-ahead a fast typist relies on), so there's no readiness
    // race — only set on wake (`resumeAgentCommand` output), never an ordinary spawn.
    if (opts.resumeCommand) proxy.write(`${opts.resumeCommand}\r`);
    tlog.info({ pid: res.pid, total: listTerminals().length }, "created");
    emitTerminalListChanged();
  }

  /** Unwind the active sync-shadow `entry` whose async spawn/wiring failed.
   *
   *  Identity-gated: acts ONLY while the registry still holds OUR `entry`. A
   *  `beginSleep` / re-spawn that raced in mid-spawn replaced it with a different
   *  entry under the same id, and that newer entry is authoritative — clobbering
   *  it here would re-introduce the F1/F2 loss (drop the sleeping flip, or evict
   *  a fresh re-spawn). When we DO still own the slot, RESTORE a `prior` sleeping
   *  record (F2: a failed WAKE must leave the dormant terminal the user can still
   *  wake, not erase it); otherwise (a fresh `spawnPty`, `prior` undefined or
   *  active) drop the shadow. Idempotent. */
  private unwindSpawnShadow(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
  ): void {
    if (getTerminal(id) !== entry) return;
    if (prior?.meta.state === "sleeping") {
      registerTerminal(id, prior);
      publishTerminalState(prior, id);
      emitTerminalListChanged();
      return;
    }
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  /** Recover from "the PTY exists on the daemon but sensor wiring failed":
   *  log the wiring error under `reason`, tear down any partial sensors, kill
   *  the orphaned PTY (a kill failure is logged, not thrown — there's nothing
   *  left to do), and unwind the sync shadow (restoring a `prior` sleeping
   *  record on a failed wake — F2). Extracted as the one reap policy so B3.3's
   *  survivor-adoption path can share it — one place to change how a half-wired
   *  PTY is reaped; `reason` distinguishes the call site. */
  private killHalfWiredPty(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    prior: TerminalProcess | undefined,
    tlog: typeof log,
    err: unknown,
    reason: string,
  ): void {
    tlog.error({ err }, reason);
    this.teardownSensors(id);
    void ptyHostClient.surface.terminal
      .kill({ id })
      .catch((killErr) =>
        tlog.error({ err: killErr }, "kill of half-wired PTY failed"),
      );
    this.unwindSpawnShadow(id, entry, prior);
  }

  /** Start the per-terminal sensor set against the pty-host's tap streams.
   *  The sensor set runs HERE, in kolu-server, so it's always the current build's
   *  code (the freshness guarantee — the most-edited code never rides the
   *  long-lived pty-host). */
  private startAwarenessSensors(
    id: TerminalId,
    entry: ActiveTerminalProcess,
    pid: number,
  ): void {
    const abort = new AbortController();
    const { signal } = abort;
    const signals: AwarenessSignals = {
      cwd: inMemoryChannel<string>(),
      title: inMemoryChannel<string>(),
      commandRun: inMemoryChannel<string>(),
      foreground: inMemoryChannel<ForegroundSample>(),
    };
    const record: AwarenessRecord = {
      pid,
      meta: entry.meta,
      currentAgent: null,
    };
    const sink = makeAwarenessSink(entry, id);

    // Bridge the raw VT taps onto the awareness signals. cwd also lands on
    // persisted metadata (the bridge owns `m.cwd`; the git sensor reads
    // `signals.cwd` to re-resolve git).
    // Fire-and-forget: the abort signal owns teardown, so the returned Promise
    // is intentionally not awaited (only the inventory reconciler awaits it).
    void bridgeStream(
      ptyHostClient.surface.cwd.get({ id }, { signal }),
      signal,
      (msg) => {
        updateServerMetadata(entry, id, (m) => {
          m.cwd = msg.cwd;
        });
        signals.cwd.publish(msg.cwd);
      },
    );
    void bridgeStream(
      ptyHostClient.surface.title.get({ id }, { signal }),
      signal,
      (msg) => signals.title.publish(msg.title),
    );
    void bridgeStream(
      ptyHostClient.surface.commandRun.get({ id }, { signal }),
      signal,
      (msg) => signals.commandRun.publish(msg.command),
    );
    void bridgeStream(
      ptyHostClient.surface.foreground.get({ id }, { signal }),
      signal,
      (msg) =>
        signals.foreground.publish({
          process: msg.process,
          foregroundPid: msg.foregroundPid,
        }),
    );
    const stopAwareness = startAwareness(record, id, signals, sink, log);

    // Natural exit: the `exit` tap yields the code once. An intentional kill
    // aborts this signal first (see `teardownSensors`), so `handleExit` only
    // ever fires for a genuine exit.
    void bridgeStream(
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

    this.lifecycles.set(id, { abort, stopAwareness });
  }

  /** Stop a terminal's sensor set + tap bridges (idempotent). Aborting the
   *  signal ends every tap subscription — including the `exit` tap, so a kill
   *  that calls this BEFORE the pty-host kill can't trip `handleExit`. */
  private teardownSensors(id: TerminalId): void {
    const lc = this.lifecycles.get(id);
    if (!lc) return;
    this.lifecycles.delete(id);
    lc.abort.abort();
    lc.stopAwareness();
  }

  /** A terminal's PTY exited naturally. Stop its sensor layer, publish the
   *  exit, drop the entry, save the session. */
  private handleExit(id: TerminalId, exitCode: number): void {
    const entry = getTerminal(id);
    if (!entry) return;
    log.child({ terminal: id }).info({ exitCode }, "exited");
    this.teardownSensors(id);
    cleanupTerminalScratch(id);
    surfaceCtx.events.terminalExit.publish({ id }, exitCode);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
  }

  async killTerminal(id: TerminalId): Promise<TerminalInfo | undefined> {
    // Kill requires an ACTIVE terminal — the symmetric mirror of `discardSleeping`
    // (which requires sleeping). A sleeping id is "not found" here so a raw `kill`
    // RPC or a multi-client race can't run a dead-PTY kill against a record sleep
    // already released; sleeping terminals exit via `discardSleeping`. The clients
    // already route sleeping → discard, so this only fences off misuse.
    const entry = getActiveTerminal(id);
    if (!entry) return undefined;
    const tlog = log.child({ terminal: id });
    tlog.info({ pid: entry.info.pid }, "killing");
    // Stop the sensor layer FIRST — this aborts the `exit` tap, so the
    // pty-host's exit (which fires on an intentional kill too, since pty-host
    // makes no kill/exit distinction) can't reach `handleExit` and
    // double-publish `terminalExit`. The kill RPC's response drives client
    // cleanup instead.
    this.teardownSensors(id);
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

  /** Begin sleeping an ACTIVE terminal: stop its sensor set and flip its registry
   *  entry to the sleeping arm IN PLACE (same id, same map slot, persisted base
   *  preserved, live overlay dropped + `sleptAt` stamped), publishing the new
   *  state — but leave the PTY ALIVE. The caller persists the session durably,
   *  THEN calls `releaseSleptPty` to kill the PTY (persist-before-kill). Sensors
   *  go down FIRST so no in-flight tap can re-publish the active meta over the
   *  flip (the sink closes over the active entry) and the later kill can't reach
   *  `handleExit` (which would unregister our sleeping entry). Returns false — a
   *  no-op — when `id` is not an active terminal (already sleeping / absent). */
  beginSleep(id: TerminalId): boolean {
    const entry = getActiveTerminal(id);
    if (!entry) return false;
    this.teardownSensors(id);
    // Flip the active entry to the sleeping arm IN PLACE. The persisted base
    // (cwd / git / lastAgentCommand / theme / notes / …) rides the `...entry.meta`
    // spread, and the live `pr` overlay is FROZEN onto the sleeping arm because
    // `SleepingTerminalSchema` declares `pr` (see `SleepingDiscriminantSchema`),
    // so the parse KEEPS it — while the rest of the live overlay (`agent` /
    // `foreground`), absent from the sleeping schema, is stripped by the same
    // parse. The dormant tile reads cwd / branch / pr off this snapshot; wake
    // re-spawns and resumes the OBSERVED `lastAgentCommand` (the PR sensor
    // re-resolves live).
    const sleeping: SleepingTerminalProcess = {
      info: { id, pid: 0 },
      meta: SleepingTerminalSchema.parse({
        ...entry.meta,
        state: "sleeping",
        sleptAt: Date.now(),
      }),
    };
    registerTerminal(id, sleeping);
    publishTerminalState(sleeping, id);
    emitTerminalListChanged();
    log
      .child({ terminal: id })
      .info("flipped to sleeping (PTY pending release)");
    return true;
  }

  /** Release the PTY of a terminal `beginSleep` already flipped to sleeping: kill
   *  the now-detached PTY and scrub its scratch. The registry entry STAYS (as
   *  sleeping). A kill failure is logged, not thrown — the record is sleeping
   *  regardless, and boot reconcile reaps any survivor (adopt-or-reap). */
  async releaseSleptPty(id: TerminalId): Promise<void> {
    try {
      await ptyHostClient.surface.terminal.kill({ id });
    } catch (err) {
      log
        .child({ terminal: id })
        .error(
          { err },
          "pty-host kill failed while sleeping; record is sleeping regardless",
        );
    }
    cleanupTerminalScratch(id);
  }

  /** Wake a SLEEPING terminal: flip it back to the active arm and re-spawn its
   *  PTY on the SAME id in its saved cwd, replaying the resume form derived from
   *  the persisted `lastAgentCommand` (via `resumeAgentCommand`, or null for a
   *  never-observed / non-resumable agent) so the conversation comes back —
   *  session-restore-of-one. The persisted base rides through WHOLE
   *  (theme/layout/notes/git/lastAgentCommand); only the live overlay is
   *  re-derived by the sensors. Returns the active info, or undefined when `id`
   *  is not a sleeping terminal. */
  wake(id: TerminalId): TerminalInfo | undefined {
    const entry = getTerminal(id);
    if (!entry || entry.meta.state !== "sleeping") return undefined;
    // Render the resume FORM from the OBSERVED `lastAgentCommand` (the command the
    // OSC 633;E sensor captured) via `resumeAgentCommand`. With the persisted
    // `agentSession` ref it resumes the EXACT conversation that was running on
    // this terminal (`claude --resume <id>`, etc., juspay/kolu#1495); without it
    // (never resolved a session) it falls back to the most-recent marker (claude
    // `-c`, codex `resume --last`, opencode `--continue`). Null for a never-
    // observed / non-resumable agent: an agent whose launch the command tap never
    // observed (e.g. a `nix run …#agent` wrapper, whose head token is `nix`) is
    // NOT resumed on wake — it wakes to a bare shell, by design (juspay/kolu#1492).
    const resumeCommand = resumeFormFor(entry.meta);
    const meta = wakeMeta(entry.meta);
    log
      .child({ terminal: id })
      .info({ resuming: resumeCommand !== null }, "waking");
    return this.registerActiveAndSpawn(id, meta, {
      cwd: meta.cwd,
      parentId: meta.parentId,
      resumeCommand: resumeCommand ?? undefined,
    });
  }

  /** Discard a SLEEPING terminal: remove its record. There is no PTY to kill —
   *  sleep already released it — so this just scrubs any leftover scratch,
   *  unregisters, and arms the autosave. Returns false when `id` is not sleeping. */
  discardSleeping(id: TerminalId): boolean {
    const entry = getTerminal(id);
    if (!entry || entry.meta.state !== "sleeping") return false;
    cleanupTerminalScratch(id);
    unregisterTerminal(id);
    emitTerminalsDirty();
    emitTerminalListChanged();
    log.child({ terminal: id }).info("discarded sleeping terminal");
    return true;
  }

  async killAllTerminals(): Promise<void> {
    const ids = listTerminals().map((info) => info.id);
    log.info({ count: ids.length }, "killing all terminals");
    for (const id of ids) this.teardownSensors(id);
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
    await getActiveTerminal(id)?.handle.ready;
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

// ── Sleep / wake / discard (local-only today, like adoption) ────────────
//
// Exposed as standalone entries rather than on the shared `TerminalEndpoint`
// interface — sleep/wake is local-only for now (manual, single-host). P3's
// remote-host sleep is an additive sibling, not a retrofit of the interface.

/** Flip an active terminal to the sleeping arm IN PLACE (PTY left alive). The
 *  facade persists the session durably, THEN calls `releaseSleptLocalPty` to kill
 *  the PTY (persist-before-kill). Returns false if `id` is not active. */
export function beginSleepLocal(id: TerminalId): boolean {
  return localEndpointImpl.beginSleep(id);
}

/** Kill the PTY of an already-flipped sleeping terminal. */
export function releaseSleptLocalPty(id: TerminalId): Promise<void> {
  return localEndpointImpl.releaseSleptPty(id);
}

/** Wake a sleeping terminal: flip to active + re-spawn on the same id, self-deriving
 *  the resume form from the persisted `lastAgentCommand` (the observed agent launch). */
export function wakeLocalTerminal(id: TerminalId): TerminalInfo | undefined {
  return localEndpointImpl.wake(id);
}

/** Discard a sleeping terminal's record (no PTY to kill). */
export function discardLocalSleeping(id: TerminalId): boolean {
  return localEndpointImpl.discardSleeping(id);
}

/** Seed a SLEEPING terminal into the registry from its saved record — the dormant
 *  analogue of adoption (there is no PTY to re-wire). Used by BOTH boot paths: the
 *  surviving-daemon reconcile (`adoptSurvivingSession`) and the cold-boot restore
 *  (`terminal.restoreSleeping`), so a slept terminal reappears as ☾ on any restart.
 *
 *  Tolerates a malformed record by DROPPING it (returns false, never throws) so one
 *  corrupt entry — a base truncated by a crash mid-write, hand-edited, or left by an
 *  older build — can't break the load for every other terminal (the
 *  `persisted-schema-stays-tolerant` policy). Idempotent: re-seeding a present id is
 *  a no-op.
 *
 *  Fires only `emitTerminalListChanged` (the wire), NEVER the autosave dirty: on
 *  cold boot the active records are not yet restored, so a snapshot-and-save here
 *  would persist a set missing them and wipe the saved session. Persistence is the
 *  caller's job — the survivor path's explicit converge, or the restore loop's
 *  active spawns. */
export function seedSleepingTerminal(record: SavedSleepingTerminal): boolean {
  const idParsed = TerminalIdSchema.safeParse(record.id);
  const recordParsed = SavedSleepingTerminalSchema.safeParse(record);
  if (!idParsed.success || !recordParsed.success) {
    log.warn(
      { id: record.id },
      "dropping malformed sleeping record at the read boundary",
    );
    return false;
  }
  const id = idParsed.data;
  if (getTerminal(id)) return false;
  const { id: _id, ...meta } = recordParsed.data;
  registerTerminal(id, { info: { id, pid: 0 }, meta });
  emitTerminalListChanged();
  return true;
}

/** Adopt a surviving local PTY at boot (B3.3) that HAS a saved record — its
 *  persisted chrome rides through whole (`adoptedMeta`), with the live daemon
 *  snapshot the authority for `cwd`/`foreground`. Exposed as a standalone entry
 *  rather than on the shared `TerminalEndpoint` interface because adoption
 *  is local-only today — P3's remote-host adoption is an additive sibling, not
 *  a retrofit of the shared interface. */
export function adoptLocalTerminal(
  record: SavedActiveTerminal,
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
 *  case the reconcile partition surfaces separately. `id` is an ALREADY-VALIDATED
 *  `TerminalId` — the caller (the boot reconcile or the inventory boundary) parsed
 *  it against `TerminalIdSchema`, so this no longer re-casts a raw wire string. */
export function adoptLocalOrphan(
  id: TerminalId,
  liveEntry: PtyHostListEntry,
): void {
  localEndpointImpl.adoptTerminal(id, orphanMeta(liveEntry), liveEntry);
}

/** Adopt a PTY discovered LIVE on the inventory feed (B3.5) — a `kaval-tui create`
 *  against the daemon kolu is already a client of. Same orphan adoption as
 *  `adoptLocalOrphan`, but it ALSO arms the session autosave (F2): the boot path
 *  converges + persists the session EXPLICITLY after adopting all survivors, so
 *  `adoptTerminal` is deliberately silent there — but a single tile appearing
 *  mid-session has no such explicit save, so without arming the autosave the
 *  out-of-band terminal would render yet never enter the saved session until some
 *  LATER dirtying event (a metadata change, an exit) happened to fire. A
 *  kolu-server restart in that window would lose it. Emitting `terminalsDirty`
 *  here schedules the same debounced `saveSession(snapshot())` a fresh spawn does,
 *  so the adopted tile is persisted on the next 500ms tick. */
export function adoptLocalInventoryOrphan(
  id: TerminalId,
  liveEntry: PtyHostListEntry,
): void {
  // Identical orphan adoption to the boot path, plus the autosave arming — so it
  // composes `adoptLocalOrphan` rather than repeating `adoptTerminal(orphanMeta…)`.
  adoptLocalOrphan(id, liveEntry);
  emitTerminalsDirty();
}

/** Fail CLOSED on a live PTY whose wire id kolu cannot represent (F1) — a
 *  non-UUID id (kolu's registry is keyed on `TerminalId` = `z.string().uuid()`).
 *  Every real client mints a UUID (`crypto.randomUUID()`: kolu-server, kaval-tui),
 *  so this is an anomaly outside kolu's domain rather than valid state to keep:
 *  it cannot be registered (no tile, no exit tap, no way to surface or kill it
 *  through kolu), and leaving it alive is a hidden live process — the same
 *  fail-open the boot recycle guards against. So KILL it rather than log-and-drop;
 *  the contract's `kill` RPC takes the opaque wire string. A kill failure is
 *  logged, not thrown — there is nothing else kolu can do, and a throw here would
 *  end the inventory subscription / abort the boot adoption for every later PTY.
 *  Shared by the boot reconcile (`reattach.ts`) and the live inventory boundary
 *  (`inventoryReconcile.ts`) so the "unrepresentable id" policy lives in one
 *  place. */
export function reapUnrepresentablePty(rawId: string): void {
  log.warn(
    { rawId },
    "live PTY id failed TerminalIdSchema — killing the unrepresentable PTY (fail-closed)",
  );
  void ptyHostClient.surface.terminal
    .kill({ id: rawId })
    .catch((err) =>
      log.error(
        { err, rawId },
        "kill of unrepresentable PTY failed; it remains live on the daemon",
      ),
    );
}
