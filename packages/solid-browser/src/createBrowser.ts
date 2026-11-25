/** `createBrowser` — the history organ of a browser, as a reactive controller
 *  over an opaque location type. This is what makes back/forward *fall out for
 *  free* once a host routes its navigation through one front door: a stack of
 *  visited locations plus a cursor into it, with the two operations a back
 *  button needs — traverse without recording — kept distinct from the one an
 *  address bar needs — assign *and* record.
 *
 *  It is deliberately ignorant of what a "location" is. `L` can be a URL, a
 *  `{ path, line }` pair, a repo-relative file in a git mode, an ssh target —
 *  the controller only ever stores, compares (via the host's `isSameEntry`),
 *  and replays them. That is the whole point of the package: a second host
 *  plugs in its own `L` and gets the same history semantics. No DOM, no
 *  `history.pushState`, no git — just the stack algebra, made reactive with
 *  solid-js signals so a toolbar's ◀/▶ enablement tracks it without wiring.
 *
 *  The forward-truncation rule is the one piece of non-obvious browser
 *  behaviour: navigating *after* going back forks history — the entries you
 *  could have gone forward to are discarded, exactly as every browser does. */

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
  // Hoist the finiteness check — maxEntries is a closed-over constant so
  // computing it inside navigate() on every push is needless work.
  const bounded = Number.isFinite(maxEntries);
  const seeded = initial !== undefined;
  // THE STACK IS PLAIN STATE, MIRRORED INTO SIGNALS. A signal write is staged:
  // it reaches readers on the next flush. The verbs below are imperative and
  // answer *now* — `back()` must return the entry it just moved to, and two
  // `navigate`s in one turn must both land — so they read and update these
  // plain fields, and publish each new value to the signals that make
  // `current` / `canBack` / `canForward` / `length` reactive.
  let stack: L[] = seeded ? [initial] : [];
  let at = seeded ? 0 : -1;
  const [entries, setEntries] = createSignal<L[]>(stack);
  const [cursor, setCursor] = createSignal(at);
  const publish = (nextStack: L[], nextAt: number): void => {
    stack = nextStack;
    at = nextAt;
    setEntries(nextStack);
    setCursor(nextAt);
  };

  const current = (): L | null => entries()[cursor()] ?? null;
  const canBack = () => cursor() > 0;
  const canForward = () => cursor() < entries().length - 1;

  const navigate = (loc: L): void => {
    const cur = stack[at] ?? null;
    if (cur !== null && isSameEntry?.(cur, loc)) {
      // Same logical page — refresh the entry in place, leave the cursor and
      // any forward entries untouched (replaceState semantics, not pushState).
      const next = [...stack];
      next[at] = loc;
      publish(next, at);
      return;
    }
    // Push: drop any forward tail (fork), append, advance. When the result
    // would exceed the cap, evict the oldest entries from the front and shift
    // the cursor down by the same count so it still points at `loc`.
    const next = [...stack.slice(0, at + 1), loc];
    const overflow = bounded ? Math.max(0, next.length - maxEntries) : 0;
    publish(overflow > 0 ? next.slice(overflow) : next, at + 1 - overflow);
  };

  const back = (): L | null => {
    if (at <= 0) return null;
    publish(stack, at - 1);
    return stack[at] ?? null;
  };

  const forward = (): L | null => {
    if (at >= stack.length - 1) return null;
    publish(stack, at + 1);
    return stack[at] ?? null;
  };

  const reset = (next?: L): void => {
    publish(next === undefined ? [] : [next], next === undefined ? -1 : 0);
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
