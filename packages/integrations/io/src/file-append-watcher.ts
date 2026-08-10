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
 * file's stat identity on a bounded cadence against a baseline this module
 * controls, and re-read whenever it changed — even when no edge arrived. The
 * edge stays the fast path (sub-interval latency in the common case); the poll
 * is the floor that makes a dropped edge self-heal within one interval.
 *
 * ## The floor is a hand-rolled `statSync` poll — NOT `fs.watchFile`
 *
 * The obvious "reuse the builtin" move is `fs.watchFile(path, { interval })`,
 * and an earlier revision of this fix used it. It was **tried and rejected** —
 * the record is kept here so it is not re-attempted:
 *
 * - **`fs.watchFile` — REJECTED: async, un-observable baseline (a P5 / guarantee
 *   violation).** `fs.watchFile` fires only relative to a baseline it captures
 *   on an **asynchronous first stat**, and exposes **no event** for when that
 *   baseline is established. So a change landing between the consumer's
 *   attach-time read and that (threadpool-delayable) baseline is folded INTO the
 *   baseline and never fires — the exact lying-state strand #1754 exists to
 *   kill, merely narrower. codex-debate reproduced it deterministically
 *   (`UV_THREADPOOL_SIZE=1`: a change at 180 ms was lost to a baseline that
 *   didn't land until ~1.3 s). A layer cannot guarantee a startup ordering it
 *   cannot observe. No startup reconciliation closes it, because there is no
 *   readiness edge to schedule against.
 * - **Hand-rolled `statSync` poll — CHOSEN.** Capturing the baseline
 *   observation **synchronously at subscribe** makes that window non-existent
 *   *by construction*: every change after subscribe is compared against a stat
 *   identity this module owns. `statSync` also throws the **real errno** directly, so ENOENT
 *   (expected-absent) stays silent and any other errno (EACCES) surfaces — with
 *   no second disambiguating stat (which `fs.watchFile`'s errno-less StatWatcher
 *   would have forced). The full key `size:mtimeMs:ino` keeps everything
 *   `fs.watchFile` was credited with (ino closes the same-size WAL-rewrite and
 *   temp+rename rotation aliases). Self-rescheduling `setTimeout` (never
 *   `setInterval`) re-arms only after each stat, so slow stats never stack.
 *
 * (Also rejected earlier: `@parcel/watcher` — still edge-based, no delivery
 * guarantee, larger blast radius; `decayTransientState` re-arm — de-escalation,
 * not re-read, and disarmed for a live `thinking` by design.)
 *
 * ## Honest residual
 *
 * Stat-sampling can only distinguish states the stat identity encodes. On a
 * coarse-mtime filesystem (1 s ext3/HFS+, 2 s FAT, many network mounts) a
 * same-size same-inode overwrite within one mtime granule is invisible to any
 * stat key — and SQLite's normal post-checkpoint pattern is exactly a same-size
 * same-inode WAL rewind (probe-verified). The edge path remains the primary
 * lane and the WAL's parent-dir inode-rearm fires an unconditional kick that
 * recovers that write; the poll is a *floor*, not a replacement for the edge.
 *
 * One edge-lifecycle note: the `fs.watch` edge is armed **once** and is not
 * re-armed on inode replacement. The poll detects a rotation (its `ino` key
 * moves), but the edge stays bound to the dead inode and goes silent, so a
 * *rotated* file falls back to poll-latency recovery for its fast path. The two
 * append-only session files (grok `events.jsonl`, claude transcript) don't
 * rotate; the SQLite WAL does (checkpoint delete+recreate), and its consumer
 * re-arms a fresh edge sub-interval via the parent-dir watcher rather than
 * relying on this floor's cadence — so edge continuity across rotation is the
 * consumer's concern where it matters, not the primitive's.
 */

import fs from "node:fs";
import type { Logger } from "@kolu/log";

/** Poll interval (ms) for the floor that every production call site passes. A
 *  module constant, never a per-call knob (`conventions.md`: "being able to
 *  override is never a feature") — the recovery latency this buys is uniform
 *  across providers. Tests inject a shorter real interval (never fake timers —
 *  a fake clock cannot drive the real `statSync`). */
export const DEFAULT_APPEND_POLL_MS = 1000;

export interface SubscribeFileAppendsOpts {
  /** Poll interval in milliseconds for the level-triggered floor. **Required**
   *  — not optional-with-default (that shape is the dead knob the fail-fast law
   *  forbids). Production passes `DEFAULT_APPEND_POLL_MS`; tests inject a short
   *  real interval, exactly as `createDirWatcher` takes `debounceMs`. */
  intervalMs: number;
  log?: Logger;
  /** Lifecycle log label for error lines, e.g. `"grok: events"`. **Required**
   *  — not optional-with-default, mirroring `intervalMs`: an optional-with-default
   *  is the dead knob the fail-fast law forbids. All call sites pass it. */
  label: string;
}

/** A poll observation — deliberately THREE-valued, never two. Collapsing a hard
 *  error into "absent" would let a transient EACCES read as a real state
 *  transition (the consumer re-derives an unreadable file — e.g. grok reads an
 *  unreadable `events.jsonl` as `thinking`, flipping a waiting tile). So `error`
 *  is its own arm: it is logged but NEVER becomes the authoritative
 *  observation and NEVER emits — a stat we couldn't take is not evidence the
 *  file's state changed. `present` carries the full identity `size:mtimeMs:ino`
 *  (ino closes the same-size WAL-rewrite / rotation aliases). */
type Observation =
  | { kind: "present"; key: string }
  | { kind: "absent" }
  | { kind: "error" };

/** `statSync` the path into a three-valued observation. ENOENT → `absent`
 *  (expected under unconditional subscribe); any other errno → logged and
 *  `error` (surface, never collapse to absent — repo fail-fast law). */
function observe(
  filePath: string,
  log: Logger | undefined,
  tag: string,
): Observation {
  try {
    const s = fs.statSync(filePath);
    return { kind: "present", key: `${s.size}:${s.mtimeMs}:${s.ino}` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { kind: "absent" };
    log?.error({ err, path: filePath }, `${tag}: stat failed`);
    return { kind: "error" };
  }
}

/** True when two observations are the same authoritative state (both absent, or
 *  both present with the same identity). `error` never reaches here — it is
 *  filtered before comparison — so it can never read as "equal to" or "different
 *  from" a known state. */
function sameState(a: Observation, b: Observation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "present" && b.kind === "present") return a.key === b.key;
  return true; // both absent
}

/**
 * Watch `filePath` for content changes with an append-robust guarantee, and
 * call `onChange` (the consumer's own debounced, change-gated handler) whenever
 * it may have changed. Subscribe **unconditionally** — the file need not exist
 * yet; the poll tolerates absence and fires `onChange` on the **absent→present
 * transition** (a session file that appears after attach) and on every
 * subsequent append.
 *
 * **The consumer must perform its own initial read on attach** for immediate
 * state — the primitive emits no *synchronous* on-attach `onChange`; the poll's
 * synchronously-captured baseline means the FIRST post-attach change is what
 * fires, at most one interval later. So: consumer reads now, the floor recovers
 * anything the edge drops thereafter.
 *
 * Returns an idempotent unsubscribe that cancels the poll and closes the edge
 * watcher behind a `closed` guard, so no late callback fires on a torn-down
 * watcher. A throwing `onChange` is caught and logged, never escaping the
 * watcher callback to crash the host.
 */
export function subscribeFileAppends(
  filePath: string,
  onChange: () => void,
  opts: SubscribeFileAppendsOpts,
): () => void {
  const { intervalMs, log, label } = opts;
  let closed = false;

  // Single guarded funnel for BOTH emission paths (the poll and the edge). A
  // watcher callback that throws would otherwise escape as an uncaught exception
  // and take down the whole host process — one session's consumer bug must not
  // kill every other session's watcher. Rechecks `closed` so no late tick fires
  // after unsubscribe, and isolates a throwing consumer to the error log (the
  // repo's guarded-watcher-callback convention, e.g. wal-subscription's
  // per-listener fault isolation).
  const emit = (): void => {
    if (closed) return;
    try {
      onChange();
    } catch (err) {
      log?.error({ err, path: filePath }, `${label}: onChange threw`);
    }
  };

  // Floor — the hand-rolled `statSync` poll. `observed` is the last authoritative
  // (present|absent) observation, captured **synchronously at subscribe** (no
  // async gap can swallow a startup change — the fs.watchFile failure this
  // replaces). The poll is the SOLE writer of `observed` (single-writer, P3): it
  // re-stats each interval and emits + advances only on a real state change. A
  // hard-`error` observation is logged but left OUT of `observed` and emits
  // nothing (F6 — an unreadable stat is not evidence the state changed). Self-
  // rescheduling so a slow stat never stacks; `.unref()`'d so it never holds the
  // process alive.
  let observed = observe(filePath, log, label);
  let pollTimer: NodeJS.Timeout = setTimeout(function poll(): void {
    if (closed) return;
    const cur = observe(filePath, log, label);
    if (cur.kind !== "error" && !sameState(cur, observed)) {
      observed = cur;
      emit();
    }
    // Recheck AFTER emit: a reentrant `unsubscribe()` from inside onChange sets
    // `closed`, and this running tick must not re-arm the timer past it (F7).
    if (closed) return;
    pollTimer = setTimeout(poll, intervalMs);
    pollTimer.unref();
  }, intervalMs);
  pollTimer.unref();

  // Fast path — the OS edge, a pure pass-through to `emit` (it never touches
  // `observed`; a poll/edge double-fire is benign — the consumer's debounce +
  // change-gate absorb it to one re-derive). `fs.watch` throws ENOENT if the
  // file isn't there yet (expected under unconditional subscribe — the poll
  // covers appearance); a non-ENOENT throw (EACCES, EMFILE) is a real fault.
  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(filePath, emit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: filePath }, `${label}: fs.watch failed`);
    }
  }

  return () => {
    if (closed) return;
    closed = true;
    clearTimeout(pollTimer);
    watcher?.close();
  };
}
