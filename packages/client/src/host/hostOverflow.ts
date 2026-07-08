/**
 * hostOverflow — the pure "active chip + as-many-as-fit" decision for the
 * host chip row (W4 header redesign, iteration 2, narrow-window stage 3).
 * Given each chip's MEASURED width (real DOM measurement lives in
 * `HostSelectorStrip.tsx`'s hidden measuring row; this module stays
 * measurement-free ON PURPOSE — jsdom reports 0 for every element's layout
 * box, so a component-rendering test couldn't pin anything here, and the
 * codebase's existing convention for this directory is pure-function-only
 * tests, e.g. `hostChipTone.ts` / `HostSelectorStrip.test.ts`) and the row's
 * available width, decides which chips render inline and which fall into
 * the trailing "⋯ +N" overflow menu.
 *
 * THE INVARIANT THIS FILE PINS: a chip's measured width never depends on
 * whether it happens to be ACTIVE — the active/inactive distinction is a
 * border/ring color swap plus dual-daemon *content* that fills a FIXED-width
 * reserved slot (empty when inactive), which costs zero layout. So when
 * every chip already fits, swapping `activeKey` between two hosts changes
 * NOTHING about which chips are visible or their order (see
 * `hostOverflow.test.ts`'s host-switch pin). It changes the OUTCOME only
 * once the newly-active host was itself overflowed — the overflow menu
 * revealing the host you just switched to is the feature working as
 * designed, not a layout regression.
 */

export type HostFit = {
  /** The pool's stable order — chips are NEVER reordered by which host is
   *  active; `order`'s own sequence is the only sequence this module ever
   *  returns. */
  key: string;
  /** The chip's measured rendered width in px (its wrapper's `offsetWidth`,
   *  including padding/border). */
  width: number;
};

export type OverflowResult = {
  /** Visible chip keys, in the SAME relative order as `order` — a chip
   *  already visible never moves when another chip enters/leaves overflow. */
  visible: string[];
  /** Overflowed chip keys, also order-preserved (the "⋯ +N" menu's own
   *  list order). */
  overflowed: string[];
};

const allVisible = (order: readonly HostFit[]): OverflowResult => ({
  visible: order.map((h) => h.key),
  overflowed: [],
});

/**
 * `containerWidth` is the row's available px width for HOST CHIPS
 * specifically — the caller has already subtracted any other fixed trailing
 * chrome that always renders regardless of overflow (the "+ add a host"
 * button). `trailingReserve` is the width of the "⋯ +N" trigger itself,
 * which is only ever rendered — and thus only ever needs reserving — once
 * the chips don't all fit; reserving it unconditionally would waste room in
 * the common all-fit case, so this function tries the FULL budget first and
 * only falls back to `containerWidth - trailingReserve` once that fails.
 */
export function computeVisibleHosts(
  order: readonly HostFit[],
  activeKey: string,
  containerWidth: number,
  trailingReserve: number,
): OverflowResult {
  const total = order.reduce((sum, h) => sum + h.width, 0);
  if (total <= containerWidth) return allVisible(order);

  const budget = containerWidth - trailingReserve;

  // Greedy PREFIX fit, in POOL order — chips fill front-to-back, stopping at
  // the first one that would exceed the budget. A prefix (not a scattered
  // greedy pack) keeps the visible set contiguous, so the strip never shows
  // a "hole" where an overflowed chip sat between two visible ones.
  let used = 0;
  let cut = order.length;
  for (let i = 0; i < order.length; i++) {
    const next = order[i];
    if (next === undefined) break;
    if (used + next.width > budget) {
      cut = i;
      break;
    }
    used += next.width;
  }
  const visible = order.slice(0, cut).map((h) => h.key);

  // The active host is the header's one MANDATORY chip (see the file header
  // "always visible at every width" invariant) — if the prefix fit dropped
  // it, make room by dropping trailing prefix members (nearest the cut
  // first) until it fits, then append it. Its OWN pool position is never
  // used to reorder `visible` — only membership changes, so a later re-widen
  // restores every dropped chip to its original slot.
  if (!visible.includes(activeKey)) {
    const active = order.find((h) => h.key === activeKey);
    if (active) {
      const need = active.width;
      while (used + need > budget && visible.length > 0) {
        const dropped = visible.pop();
        const droppedFit = order.find((h) => h.key === dropped);
        used -= droppedFit?.width ?? 0;
      }
      visible.push(activeKey);
      used += need;
    }
  }

  const visibleSet = new Set(visible);
  return {
    visible: order.filter((h) => visibleSet.has(h.key)).map((h) => h.key),
    overflowed: order.filter((h) => !visibleSet.has(h.key)).map((h) => h.key),
  };
}
