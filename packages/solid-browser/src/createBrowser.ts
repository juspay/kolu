import { createSignal } from "solid-js";

export type Browser<L> = {
  /** The location at the cursor, or `null` when no location has been visited. */
  current: () => L | null;
  /** Is there an earlier entry to return to? Drives a ◀ button's enablement. */
  canBack: () => boolean;
  /** Is there a later entry to advance to? Drives a ▶ button's enablement. */
  canForward: () => boolean;
  /** Assign **and** record. Truncates any forward entries (navigating after a
   *  back forks history), appends `loc`, and advances the cursor to it — the
   *  address-bar / link-click path. When `isSameEntry(current, loc)` holds,
   *  the current entry is refreshed *in place* instead (reloading a page
   *  doesn't deepen history), preserving any forward entries. */
  navigate: (loc: L) => void;
  /** Traverse one entry back **without** recording. Returns the now-current
   *  location, or `null` if already at the start (in which case nothing
   *  moved — the caller should not re-apply). */
  back: () => L | null;
  /** Traverse one entry forward **without** recording. Returns the now-current
   *  location, or `null` if already at the end. */
  forward: () => L | null;
  /** Total entries on the stack — for tests and diagnostics. */
  length: () => number;
  /** Clear the stack back to empty (or to a single `initial` entry), **in
   *  place**. The controller instance is preserved, so reactive reads of
   *  `current` / `canBack` / `canForward` stay subscribed and update — a host
   *  that holds the same `Browser` across a context change (e.g. resetting
   *  history when the underlying repo changes) keeps working without re-wiring.
   *  Discarding the instance and building a fresh one instead would strand
   *  those subscriptions on the dead object — the ◀/▶ enablement would freeze. */
  reset: (initial?: L) => void;
};

export type CreateBrowserOptions<L> = {
  /** Seed the history with one entry so `current()` is non-null from the
   *  start (e.g. a restored session's last-viewed location). */
  initial?: L;
  /** When two locations name the "same page" — e.g. the same file at a
   *  different line — `navigate` refreshes the current entry in place rather
   *  than recording a duplicate. Omit to record every `navigate` as a new
   *  entry (the default: `navigate` always pushes). */
  isSameEntry?: (current: L, next: L) => boolean;
  /** Cap the stack so a long-lived session can't grow history without
   *  bound (the repo's no-unbounded-growth rule for usage-driven
   *  collections). When a `navigate` push would exceed this, the oldest
   *  entries are evicted from the front and the cursor is shifted to stay
   *  on the same logical entry — browser behaviour: the deep past falls off
   *  the back of the stack, never the recent. Defaults to {@link DEFAULT_MAX_ENTRIES};
   *  pass a finite value to override, `Infinity` to disable. */
  maxEntries?: number;
};

/** Default history cap — generous enough that real back/forward sessions
 *  never hit it, small enough that a runaway producer can't leak. Browsers
 *  themselves cap (Chromium ~50/tab); 200 here gives ample headroom while
 *  staying bounded. */
export const DEFAULT_MAX_ENTRIES = 200;

export function createBrowser<L>(
  options: CreateBrowserOptions<L> = {},
): Browser<L> {
  const { initial, isSameEntry, maxEntries = DEFAULT_MAX_ENTRIES } = options;
  const bounded = Number.isFinite(maxEntries);
  const seeded = initial !== undefined;
  const [entries, setEntries] = createSignal<L[]>(seeded ? [initial] : []);
  const [cursor, setCursor] = createSignal(seeded ? 0 : -1);

  const current = (): L | null => entries()[cursor()] ?? null;
  const canBack = () => cursor() > 0;
  const canForward = () => cursor() < entries().length - 1;

  const refreshCurrentEntry = (loc: L): void => {
    const c = cursor();
    setEntries((es) => {
      const next = [...es];
      next[c] = loc;
      return next;
    });
  };

  const pushForkingForward = (loc: L): void => {
    const forked = [...entries().slice(0, cursor() + 1), loc];
    const evicted = bounded ? Math.max(0, forked.length - maxEntries) : 0;
    setEntries(evicted > 0 ? forked.slice(evicted) : forked);
    setCursor((x) => x + 1 - evicted);
  };

  const navigate = (loc: L): void => {
    const cur = current();
    if (cur !== null && isSameEntry?.(cur, loc)) {
      refreshCurrentEntry(loc);
      return;
    }
    pushForkingForward(loc);
  };

  const back = (): L | null => {
    if (!canBack()) return null;
    setCursor((x) => x - 1);
    return current();
  };

  const forward = (): L | null => {
    if (!canForward()) return null;
    setCursor((x) => x + 1);
    return current();
  };

  const reset = (next?: L): void => {
    setEntries(next === undefined ? [] : [next]);
    setCursor(next === undefined ? -1 : 0);
  };

  return {
    current,
    canBack,
    canForward,
    navigate,
    back,
    forward,
    length: () => entries().length,
    reset,
  };
}
