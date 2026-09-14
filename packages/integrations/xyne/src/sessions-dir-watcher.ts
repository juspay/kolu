/**
 * Process-wide subscription on the sessions tree — the external-change
 * signal that can make `resolveSession` flip without a title event (Xyne's
 * runtime writes the transcript + summary on its own schedule; this is not
 * tied to title).
 *
 * Xyne creates a NEW transcript per session inside
 * `agent/sessions/<encoded-cwd>/` — no long-lived pid map like Grok's
 * `active_sessions.json`. The newest transcript for the cwd IS the session
 * identity; this watcher is the rewake that lands it.
 *
 * Per-cwd transcripts are timestamp-named, so no fixed filename can be
 * named ahead of time — instead of the filename-filtered
 * `createDirFilenameWatcher` the other agents use, this installs a single
 * recursive `fs.watch` on `agent/sessions` filtered to `.jsonl` events,
 * backed by a 1s `statSync` poll floor on the subtree's newest transcript
 * (the same hand-rolled, sync-baseline recipe `subscribeFileAppends` uses
 * for single files — `fs.watchFile`'s async baseline was rejected for
 * exactly this guarantee shape, juspay/kolu#1754). The consumer's derive
 * (`deriveXyneInfo` + `agentInfoEqual`) gates repeated wake-ups the same
 * way the codex WAL fan-out does.
 *
 * Lazy: the orchestrator only calls `install` the first time any terminal
 * reports `isPresent`. One shared watcher for the process — install is
 * once; a second call is a no-op (same contract as codex WAL / grok).
 * Pure observer: never creates `~/.xyne`; an absent sessions tree simply
 * reports no edge and the poll floor observes absence.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import { newestTranscript, xyneSessionsPresent } from "./core.ts";

let installed = false;

/** Poll cadence for the dropped-edge floor — matches the dir-filename
 *  watcher's recovery bound. A module constant, not a caller knob. */
const POLL_MS = 1000;

/** Coarse identity of the sessions tree — the value the poll floor
 *  diffs to wake the adapter. Joins:
 *
 *   1. the newest `<cwd>/<file>.jsonl` path — catches a brand-new cwd
 *      dir and a new session inside an old one (both flip `resolveSession`),
 *   2. that file's size+mtime+ino — catches appends to the CURRENT
 *      newest, so a turn landing between polls is not stranded.
 *
 *  Sidecar writes are invisible BY DESIGN: they cannot flip a
 *  resolution (only the summary-bearing session's own watcher derives
 *  from them). The identity is intentionally coarse — the adapter
 *  re-reads and derives on every wake, so any flip is enough; the
 *  transcript+sidecar pair gives no finer identity on disk. */
function observeNewest(log?: Logger): string {
  try {
    if (!xyneSessionsPresent()) return "absent";
    // Join per-cwd newest transcript identities. resolveSession picks the
    // newest transcript per cwd, so the rewake identity must cover the same
    // granularity: a flip in ANY cwd dir (new session, resumption append,
    // deletion) changes this cwd's own newest — not just the tree-global
    // newest — and must fire the floor. Each `cwdDir` contributes its own
    // parsed-(ts,id) winner + size/mtime/ino. A global "one winner" identity
    // strands resolution flips in every non-winner cwd dir for a full poll
    // cycle or longer.
    const perDir: string[] = [];
    for (const cwdDir of fs.readdirSync(SESSIONS_DIR).sort()) {
      const sub = path.join(SESSIONS_DIR, cwdDir);
      let names: string[];
      try {
        if (!fs.statSync(sub).isDirectory()) continue;
        names = fs.readdirSync(sub);
      } catch {
        continue; // raced with an unlink — the next poll re-reads
      }
      const winner = newestTranscript(names);
      if (!winner) continue;
      let st: fs.Stats;
      try {
        st = fs.statSync(path.join(sub, winner.name));
      } catch {
        return "raced"; // unlinked between readdir and stat
      }
      perDir.push(
        `${cwdDir}/${winner.name}:${st.size}:${st.mtimeMs}:${st.ino}`,
      );
    }
    if (perDir.length === 0) return "empty";
    return perDir.join("\n");
  } catch (err) {
    log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions observe failed");
    return "error";
  }
}

export function subscribeSessionDirs(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): void {
  if (installed) return;
  installed = true;

  const emit = (): void => {
    try {
      onChange();
    } catch (err) {
      onError(err);
    }
  };

  // Floor — a 1s statSync poll on the subtree's newest-transcript identity.
  // Baseline captured synchronously at subscribe: an edge/coalesce drop
  // self-heals within POLL_MS. This is the SAME poll identity the
  // subscribeFileAppends recipe uses; the per-cwd timestamps sort under
  // one tree so the newest-transcript identity covers every re-resolution
  // the adapter can make. Self-rescheduling so slow stats never stack;
  // unref'd so it never holds the process alive.
  let observed = observeNewest(log);
  const poll = (): void => {
    const cur = observeNewest(log);
    if (cur !== "error" && cur !== observed) {
      observed = cur;
      emit();
    }
    setTimeout(poll, POLL_MS).unref();
  };
  setTimeout(poll, POLL_MS).unref();

  // Edge fast path — a recursive watch on the tree. Kept OFF the critical
  // path: the floor above already recovers within POLL_MS, this only
  // shortens the common case. A recursive fs.watch is Linux-inotify and
  // macOS-FSEvents only; on any platform where it throws/dies, the floor
  // keeps detection exact.
  try {
    fs.watch(SESSIONS_DIR, { recursive: true }, (_evt, filename) => {
      if (filename === null || filename.endsWith(".jsonl")) emit();
    }).on("error", (err: unknown) => {
      log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions watch failed");
    });
  } catch (err) {
    // Watch failure (e.g. absent tree) is absorbed: the poll floor still
    // recovers the appearance. Logged at error so a truly broken watcher
    // is visible, never silent.
    log?.error({ err, dir: SESSIONS_DIR }, "xyne: sessions dir not watchable");
  }

  log?.info({ dir: SESSIONS_DIR }, "xyne: sessions watcher installed");
}
