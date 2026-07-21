/**
 * `subscribeFileAppends` — an append-robust single-file change subscription.
 *
 * ## Why this exists (juspay/kolu#1754)
 *
 * Every agent session-watcher (claude transcript JSONL, grok `events.jsonl`,
 * codex/opencode SQLite WAL) derives live agent state by re-reading a file when
 * an `fs.watch` event fires. `fs.watch` is a pure **edge** signal, and the OS is
 * explicitly permitted to drop or coalesce an edge (macOS kqueue coalesces an
 * append that lands right after attach; an inotify queue overflow across a
 * suspend drops appearance edges). On a fast turn, the terminal completion
 * append arrives after attach with no subsequent write — so a single dropped
 * edge strands the agent's live-state on a transient (`thinking`) forever,
 * because nothing ever re-reads. That is #1754.
 *
 * The fix is a **level-triggered floor** under the edge fast path: poll the
 * file's stat record on a bounded cadence and re-read whenever it changed,
 * even when no edge arrived. The edge stays the fast path (sub-interval latency
 * in the common case); the poll is the floor that makes a dropped edge
 * self-heal within one interval.
 *
 * ## Why `fs.watchFile`, not a hand-rolled poll loop
 *
 * Node's builtin `fs.watchFile(path, { interval }, listener)` IS this floor:
 * libuv's `uv_fs_poll` re-stats the path on `interval` (re-arming only after
 * each stat completes, so slow stats never stack) and invokes the listener
 * whenever the **full stat record** changes — a strict superset of a
 * `(size, mtime)` key that includes `ino`, closing the same-size WAL-rewrite and
 * temp+rename rotation aliases a size/mtime key would miss. It tolerates a
 * not-yet-existing file and fires on `absent→present` (appearance) and
 * `present→absent` (deletion) transitions. Hand-rolling a `setTimeout` poll with
 * a `(size, mtime)` cell would re-implement — worse — what the runtime ships;
 * repo law (`conventions.md`: prefer external/builtin, reuse the source of
 * truth) makes reaching for the builtin mandatory.
 *
 * **Considered and rejected — the *bare* builtin, `fs.watchFile` alone.** It
 * cannot honor the repo's `caught-error-must-not-collapse-to-empty` law on its
 * own: the `StatWatcher` exposes **no errno channel**, and a permission fault
 * (EACCES) surfaces to the listener as a byte-identical **zeroed `Stats`** —
 * indistinguishable from an expected-absent (ENOENT) file (probe-verified on
 * Node v24). Reading a zeroed fire as "absent, stay silent" would swallow a real
 * EACCES. So the floor is the **composition**: the builtin poll PLUS one
 * disambiguating `fs.stat` on a zeroed-stats fire, whose only job is to pick the
 * log level — ENOENT stays silent (the `wal-subscription.ts` precedent), any
 * other errno logs at `error`. (Also rejected earlier: `@parcel/watcher` — still
 * edge-based, no delivery guarantee, larger blast radius;
 * `decayTransientState` re-arm — semantically de-escalation, not re-read, and
 * disarmed for a live `thinking` by design.)
 *
 * ## Honest residual
 *
 * Stat-sampling can only distinguish states the stat record encodes. On a
 * coarse-mtime filesystem (1 s ext3/HFS+, 2 s FAT, many network mounts) a
 * same-size same-inode overwrite within one mtime granule is invisible to any
 * stat key — and SQLite's normal post-checkpoint pattern is exactly a same-size
 * same-inode WAL rewind (probe-verified). The edge path remains the primary
 * lane and the WAL's parent-dir inode-rearm fires an unconditional kick that
 * recovers that write; the poll is a *floor*, not a replacement for the edge.
 */

import fs from "node:fs";
import type { Logger } from "@kolu/log";

/** Poll interval (ms) for the `fs.watchFile` floor that every production call
 *  site passes. A module constant, never a per-call knob (`conventions.md`:
 *  "being able to override is never a feature") — the recovery latency this
 *  buys is uniform across providers. The refuter's probe recovered a dropped
 *  terminal edge in 903 ms at this interval. Tests inject a shorter real
 *  interval (never fake timers — a fake clock cannot drive libuv's real stat). */
export const DEFAULT_APPEND_POLL_MS = 1000;

export interface SubscribeFileAppendsOpts {
  /** Poll interval in milliseconds for the level-triggered floor. **Required**
   *  — not optional-with-default (that shape is the dead knob the fail-fast law
   *  forbids). Production passes `DEFAULT_APPEND_POLL_MS`; tests inject a short
   *  real interval, exactly as `createDirFilenameWatcher` takes `debounceMs`. */
  intervalMs: number;
  log?: Logger;
  /** Lifecycle log label for error lines, e.g. `"grok: events"`. **Required**
   *  — not optional-with-default, mirroring `intervalMs`: an optional-with-default
   *  is the dead knob the fail-fast law forbids. All call sites pass it. */
  label: string;
}

/**
 * Watch `filePath` for content changes with an append-robust guarantee, and
 * call `onChange` (the consumer's own debounced, change-gated handler) whenever
 * it may have changed. Subscribe **unconditionally** — the file need not exist
 * yet; the floor tolerates absence and fires `onChange` on the **absent→present
 * transition** (a session file that appears after attach) and on every
 * subsequent append.
 *
 * **The consumer must perform its own initial read on attach** for immediate
 * state — the primitive emits no *synchronous* on-attach `onChange`, because
 * `fs.watchFile` fires only on a change from the stat it samples at watch-start.
 * A one-shot **startup reconciliation** (below) fires `onChange` once after
 * `intervalMs` **only if** the file's stat moved since attach — closing the
 * async-baseline race without disturbing a genuinely idle file. It is a
 * gap-closer, not the initial read (too late for that): consumer reads now.
 *
 * Returns an idempotent unsubscribe that closes both watchers and the startup
 * timer behind a `closed` guard rechecked after the async disambiguating stat,
 * so no late callback fires on a torn-down watcher. A throwing `onChange` is
 * caught and logged, never escaping the watcher callback.
 */
/** Full stat identity (`size:mtimeMs:ino`) for the one-shot startup
 *  reconciliation, or null when the file is absent/unstattable — so an
 *  absent→present appearance in the startup window also registers as a change. */
function statKey(filePath: string): string | null {
  try {
    const s = fs.statSync(filePath);
    return `${s.size}:${s.mtimeMs}:${s.ino}`;
  } catch {
    return null;
  }
}

export function subscribeFileAppends(
  filePath: string,
  onChange: () => void,
  opts: SubscribeFileAppendsOpts,
): () => void {
  const { intervalMs, log, label } = opts;
  const tag = label;
  let closed = false;

  // Single guarded funnel for BOTH emission paths (the `fs.watch` edge and the
  // `fs.watchFile` floor). A watcher callback that throws would otherwise escape
  // as an uncaught exception and take down the whole host process — one session's
  // consumer bug must not kill every other session's watcher. Rechecks `closed`
  // so no late tick fires after unsubscribe, and isolates a throwing consumer to
  // the error log (the repo's guarded-watcher-callback convention, e.g.
  // wal-subscription's per-listener fault isolation).
  const emit = (): void => {
    if (closed) return;
    try {
      onChange();
    } catch (err) {
      log?.error({ err, path: filePath }, `${tag}: onChange threw`);
    }
  };

  // Fast path — the OS edge. `fs.watch` throws synchronously if the file is not
  // there yet (unconditional subscribe): that is expected, the floor covers
  // appearance and every subsequent append. A non-ENOENT throw (EACCES, EMFILE)
  // is a real fault and must surface.
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(filePath, emit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: filePath }, `${tag}: fs.watch failed`);
    }
  }

  // Floor — Node's builtin interval stat-poller (libuv `uv_fs_poll`). Fires on
  // any stat-record change, tolerates absence, and never stacks slow stats.
  const listener = (curr: fs.Stats): void => {
    if (closed) return;
    // A zeroed `Stats` (ino 0) is either an absent file (ENOENT — expected) or a
    // hard stat error (EACCES — must surface); the StatWatcher can't tell them
    // apart, so one disambiguating `fs.stat` picks the log level. It does NOT
    // gate `onChange`: a transition (append / appearance / deletion) always
    // re-reads; the consumer's read is idempotent and change-gated downstream.
    if (curr.ino === 0) {
      fs.stat(filePath, (err) => {
        if (closed) return;
        if (err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
          log?.error({ err, path: filePath }, `${tag}: stat failed`);
        }
      });
    }
    emit();
  };
  const statWatcher = fs.watchFile(filePath, { interval: intervalMs }, listener);
  // Don't keep the process alive for the poll — it's a background floor.
  statWatcher.unref();

  // Startup reconciliation (juspay/kolu#1754). `fs.watchFile` establishes its
  // comparison baseline on an ASYNCHRONOUS first stat, so a change that lands
  // between the consumer's attach-time read and that baseline is folded INTO the
  // baseline and would never fire — the attach-window re-strand a fast turn can
  // still hit. Capture a baseline stat-key synchronously now (before that async
  // baseline), then once after `intervalMs` (by which the floor's baseline is
  // long since captured) re-stat and `emit` ONLY if the key moved — recovering
  // anything the startup window swallowed, without a spurious fire on a
  // genuinely idle file (constraint 5 intact). This is a one-shot gap-closer,
  // not a second poll loop — the floor still owns the ongoing polling. Cleared
  // on unsubscribe; `.unref()`'d so it never holds the process.
  const startupKey = statKey(filePath);
  const startupReconcile: NodeJS.Timeout = setTimeout(() => {
    if (!closed && statKey(filePath) !== startupKey) emit();
  }, intervalMs);
  startupReconcile.unref();

  return () => {
    if (closed) return;
    closed = true;
    clearTimeout(startupReconcile);
    watcher?.close();
    fs.unwatchFile(filePath, listener);
  };
}
