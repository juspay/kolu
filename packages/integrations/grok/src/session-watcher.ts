/**
 * GrokWatcher — per-session lifecycle. Watches `events.jsonl` +
 * `summary.json` + `signals.json` with a trailing-edge debounce and emits
 * GrokInfo on change, gated by `agentInfoEqual`.
 *
 * Pure observer: never creates paths under `~/.grok`. If a file is
 * missing, watches its parent directory (when that exists) and re-arms
 * when the basename appears — same observe-without-mutate idea as
 * Claude's session watchers.
 *
 * ## Debounce + maxWait (juspay/kolu#1952)
 *
 * Grok's `events.jsonl` is *not* a sparse transcript: a single turn can append
 * hundreds of `phase_changed` lines per second (`streaming_text` /
 * `streaming_reasoning`). A pure trailing-edge debounce (reset on every edge)
 * never reaches its quiet window while that burst is live — so `emitIfChanged`
 * freezes on the pre-burst state for the whole stream, and the 1s append-poll
 * floor (#1754) is defeated too (it feeds the *same* `schedule()`, which the
 * next fs.watch edge re-arms before 150ms elapses).
 *
 * `DEBOUNCE_MAX_MS` caps how long a pending re-derive can be postponed: after
 * that budget the timer fires even if edges keep arriving. Quiet turns still
 * settle in `DEBOUNCE_MS`; hot turns publish at least every maxWait.
 */

import fs from "node:fs";
import path from "node:path";
import { agentInfoEqual } from "anyagent";
import { DEFAULT_APPEND_POLL_MS, subscribeFileAppends } from "kolu-io";
import type { Logger } from "kolu-shared";
import { deriveGrokInfo, type GrokSession } from "./core.ts";
import type { GrokInfo } from "./schemas.ts";

/** Quiet-window coalescing for sparse writes (summary rename, single phase). */
export const DEBOUNCE_MS = 150;
/**
 * Upper bound on how long continuous `events.jsonl` edges may postpone a
 * re-derive. Must be ≤ the append-poll interval so a hot stream still
 * publishes within one floor tick of the first change in a burst; kept as a
 * named export so the starvation regression pins the same number.
 */
export const DEBOUNCE_MAX_MS = 500;

export interface GrokWatcher {
  readonly session: GrokSession;
  destroy(): void;
}

export function createGrokWatcher(
  session: GrokSession,
  onChange: (info: GrokInfo) => void,
  log?: Logger,
): GrokWatcher {
  let destroyed = false;
  let lastInfo: GrokInfo | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Wall-clock ms when the current pending debounce window opened; null when
   *  no re-derive is scheduled. Anchors `DEBOUNCE_MAX_MS`. */
  let pendingSince: number | null = null;
  // One teardown collection for every "run on destroy" concern: raw fs.watch
  // handles wrap to `() => w.close()`, and the append-robust floor
  // (juspay/kolu#1754) already returns an unsubscribe of the same shape.
  const cleanups: Array<() => void> = [];

  function emitIfChanged(): void {
    if (destroyed) return;
    const info = deriveGrokInfo(session, log);
    if (agentInfoEqual(info, lastInfo)) return;
    lastInfo = info;
    log?.debug(
      {
        state: info.state,
        model: info.model,
        session: info.sessionId,
      },
      "grok state updated",
    );
    onChange(info);
  }

  function schedule(): void {
    if (destroyed) return;
    const now = Date.now();
    if (pendingSince === null) pendingSince = now;
    if (timer) clearTimeout(timer);
    // Trailing quiet window, hard-capped so a phase-spam burst cannot starve
    // the re-derive past DEBOUNCE_MAX_MS from the first pending edge.
    const delay = Math.min(
      DEBOUNCE_MS,
      Math.max(0, DEBOUNCE_MAX_MS - (now - pendingSince)),
    );
    timer = setTimeout(() => {
      timer = null;
      pendingSince = null;
      emitIfChanged();
    }, delay);
  }

  function watchPath(p: string): void {
    // Edge-only file watch for summary.json / signals.json (events.jsonl goes
    // through subscribeFileAppends below, not here). Watch the inode directly;
    // when the file isn't there yet, bootstrap on the parent dir and re-arm
    // when the basename appears. A direct inode watch dies after Grok's
    // temp+rename rewrite of summary.json — that's benign: deriveGrokInfo
    // re-reads summary.json / signals.json fresh on every events.jsonl tick, so
    // a dropped edge here only stales the model/title/token display until the
    // next events tick, never lies about state. Never mkdir.
    try {
      const w = fs.watch(p, () => schedule());
      cleanups.push(() => w.close());
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, path: p }, "grok: failed to watch session file");
        return;
      }
    }
    // File not present yet — watch the parent dir (if it exists) and re-arm
    // when the basename appears (Grok made the session dir but hasn't flushed
    // the file). Once the file lands, its first event reschedules and the tile
    // lights up; this is only the appears-later bootstrap, not the steady
    // state. Never mkdir.
    const dir = path.dirname(p);
    const base = path.basename(p);
    try {
      const w = fs.watch(dir, (_evt, filename) => {
        if (
          filename === base ||
          filename === `${base}.tmp` ||
          filename === null
        ) {
          schedule();
        }
      });
      cleanups.push(() => w.close());
    } catch (err2) {
      log?.debug(
        { err: err2, path: p },
        "grok: session path not watchable yet",
      );
    }
  }

  // events.jsonl is the primary state signal. Wrap it in the append-robust
  // floor (juspay/kolu#1754): a dropped/coalesced terminal-append edge — macOS
  // kqueue especially — would otherwise strand the tile on a transient state
  // forever (grok has no other fallback timer). Subscribe UNCONDITIONALLY (the
  // Q7 reversal): grok's old dir-watch bootstrap never re-armed a file watch
  // after events.jsonl appeared and kqueue dir-watches never fire on child
  // content appends, so a session matched before the file was flushed got no
  // steady-state watch on macOS at all. The floor tolerates absence and fires
  // on appearance, closing that hole with the same mechanism.
  cleanups.push(
    subscribeFileAppends(session.eventsPath, schedule, {
      intervalMs: DEFAULT_APPEND_POLL_MS,
      log,
      label: "grok: events",
    }),
  );
  // summary.json / signals.json stay edge-only (dir-watch bootstrap for the
  // temp+rename rewrite). Both are re-read on every events.jsonl tick, so a
  // dropped edge there only staleness the model/title/token display until the
  // next events tick — a display-freshness residual, not a state lie (Q6).
  watchPath(session.summaryPath);
  // signals.json carries contextTokensUsed — re-emit when the window moves.
  watchPath(session.signalsPath);
  // Standard grep-able watcher-lifecycle line (matches active-sessions-watcher
  // and the claude-code session watcher) so operator watcher-count correlation
  // sees this per-session watcher come up.
  log?.info(
    { session: session.id, dir: path.dirname(session.eventsPath) },
    "grok: session watcher installed",
  );
  // Initial emit — lights the indicator immediately on match.
  emitIfChanged();

  return {
    session,
    destroy() {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      pendingSince = null;
      for (const c of cleanups) {
        try {
          c();
        } catch {
          /* ignore teardown races */
        }
      }
      cleanups.length = 0;
      log?.info({ session: session.id }, "grok: session watcher retired");
    },
  };
}
