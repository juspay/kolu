/** When did the active host's connect log last say something? — the clock behind the
 *  boot-stalled card's "No new output in the last 14 min" (the stall a wedged
 *  `nix copy` sat in for 25 minutes while the card only said "Still provisioning…").
 *
 *  The connection frame carries the log tail and the episode's `sinceMs`, but not WHEN
 *  its last line arrived — and that wire schema is shared with drishti, so the time is
 *  derived here instead: `canvasMode` notes the tail on every 1s tick
 *  ({@link noteConnectTail}), and the clock restarts whenever the last line changes.
 *  Noting starts with the connect overlay, long before the card can mount, so the card's
 *  reading spans the whole silence this browser watched. It can only UNDER-state (a tab
 *  opened mid-silence starts counting then), which is why the copy says "in the last …".
 *
 *  Module-lifetime and per-host like the boot anchors in `bootDeadline.ts`, pruned the
 *  same way when a host leaves membership. Monotonic `nowMs`, like them. */

import type { LogLine } from "../ui/logTailChrome";

interface TailMark {
  /** The last line's identity: its text plus the tail's length, so a repeated line
   *  that grew the tail still counts as news. */
  readonly key: string;
  readonly line: string;
  readonly atMs: number;
}

const marks = new Map<string, TailMark>();

/** Record this frame's tail for `hostEnc`; restarts the clock when its last line changed. */
export function noteConnectTail(
  hostEnc: string,
  log: readonly LogLine[],
  nowMs: number,
): void {
  const last = log.at(-1);
  if (last === undefined) {
    marks.delete(hostEnc);
    return;
  }
  const key = `${log.length}\u0000${last.line}`;
  if (marks.get(hostEnc)?.key !== key)
    marks.set(hostEnc, { key, line: last.line, atMs: nowMs });
}

/** The last line of `hostEnc`'s connect log and how long it has stood unchanged, or
 *  `undefined` when there is no line. */
export function connectTailQuiet(
  hostEnc: string,
  nowMs: number,
): { readonly lastLine: string; readonly silentMs: number } | undefined {
  const mark = marks.get(hostEnc);
  return mark === undefined
    ? undefined
    : { lastLine: mark.line, silentMs: Math.max(0, nowMs - mark.atMs) };
}

/** Forget the hosts no longer in membership (see `pruneBootAnchors`). */
export function pruneConnectTails(memberEncs: readonly string[]): void {
  const keep = new Set(memberEncs);
  for (const k of marks.keys()) if (!keep.has(k)) marks.delete(k);
}

/** Test-only: clear every host's mark. */
export function resetConnectTails(): void {
  marks.clear();
}
