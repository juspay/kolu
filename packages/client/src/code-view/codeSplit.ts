/** THE CODE VIEW'S SPLIT — the tree and the file, stacked or beside, and the
 *  tree's share in each. Everything the one Code view (`CodeTab.tsx`) needs to
 *  lay out its single `<Resizable>`, so none of it is spelled twice.
 *
 *  The place that mounts the view picks the arrangement, because how much room
 *  there is belongs to that place: the Right panel always stacks; a picked work
 *  measures its own box and asks {@link codeArrangement}. Changing arrangement
 *  moves the same tree and the same file; it rebuilds neither.
 *
 *  The tree's share is one number per arrangement, never one for both: a slim
 *  side-by-side tree would otherwise come back as a few rows of the Right
 *  panel's height.
 *  - stacked: its share of the HEIGHT, the server preference every stacked Code
 *    view reads (`useRightPanel().codeTabTreeSize`), written as it moves; the
 *    preference writer coalesces.
 *  - beside: its share of the WIDTH, kept per device, like the Conductor's
 *    sidebar width. Written once per pointer drag, at its end — a
 *    `localStorage` write per pointer move is the thing `WidthResizeHandle.tsx`
 *    rules out — and at once for a keyboard step.
 *  Corvu re-emits the sizes it is handed (on mount, and when the arrangement
 *  changes); an emission equal to the share already held writes nothing. */

import { type Accessor, batch, createSignal, untrack } from "solid-js";
import { defaultInvalidWarning, persistedPref } from "../persistedPref";
import { useRightPanel } from "../right-panel/useRightPanel";
import { controlledSizes, realSizes } from "../ui/corvuResizable";

/** Tree above the file, or tree left of the file. */
export type CodeArrangement = "stacked" | "beside";

/** The narrowest box that stands the tree beside the file. At the default
 *  share (0.3) it is the first round width where the tree keeps the works
 *  sidebar's own floor of 192px (0.3 × 720 = 216px) and the file keeps the
 *  480px the Right panel gives it in a 1920px window (0.7 × 720 = 504px).
 *  Every phone and small tablet is under it, so they keep the stacked view. */
const BESIDE_MIN_WIDTH_PX = 720;

/** How a box `widthPx` wide arranges the view. An unmeasured box is stacked. */
export function codeArrangement(widthPx: number | null): CodeArrangement {
  return widthPx != null && widthPx >= BESIDE_MIN_WIDTH_PX
    ? "beside"
    : "stacked";
}

/** The side-by-side share: where it is kept, its default, and the band a
 *  stored or dragged value must fall in. */
const BESIDE_SHARE = {
  name: "kolu-code-tab-beside-tree-size",
  fallback: 0.3,
  min: 0.1,
  max: 0.9,
} as const;

const inBand = (n: number) => n >= BESIDE_SHARE.min && n <= BESIDE_SHARE.max;

const [besideShare, setBesideShare] = persistedPref<number>({
  name: BESIDE_SHARE.name,
  fallback: BESIDE_SHARE.fallback,
  // Only a finite JSON number in the band: anything else reads as the
  // default, and says so in the console.
  parse: (raw) => {
    const n: unknown = JSON.parse(raw);
    if (typeof n !== "number" || !inBand(n)) {
      throw new Error(`invalid side-by-side tree share: ${raw}`);
    }
    return n;
  },
  onInvalid: defaultInvalidWarning(BESIDE_SHARE.name, BESIDE_SHARE.fallback),
});

/** Corvu rounds sizes to 6 decimals: below that an emission is an echo. */
const ECHO = 1e-6;

/** What each arrangement hands Corvu. The tree's other edge is the handle's
 *  side; the handle is a zero-size line whose `::before` is the hit area. */
const LAYOUT = {
  stacked: {
    orientation: "vertical",
    treeEdge: "border-b",
    handle:
      "shrink-0 h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors",
  },
  beside: {
    orientation: "horizontal",
    treeEdge: "border-e",
    handle:
      "shrink-0 w-0 relative before:absolute before:inset-y-0 before:-left-1 before:w-2 before:cursor-col-resize before:hover:bg-accent/30 before:transition-colors",
  },
} as const;

export interface CodeSplit {
  /** Orientation and classes for the arrangement. */
  readonly layout: () => (typeof LAYOUT)[CodeArrangement];
  /** Corvu's controlled `sizes`: the tree's share, then the file's. */
  readonly sizes: Accessor<number[]>;
  readonly onSizesChange: (sizes: number[]) => void;
  readonly onHandleDrag: () => void;
  readonly onHandleDragEnd: () => void;
}

/** The split for a view arranged as `arrangement` says. Call from a component
 *  body. */
export function createCodeSplit(
  arrangement: Accessor<CodeArrangement>,
): CodeSplit {
  const rightPanel = useRightPanel();
  // A pointer drag in flight, beside: the share it has reached, not yet stored.
  let pointerDrag = false;
  const [dragShare, setDragShare] = createSignal<number | null>(null);
  const share = () =>
    arrangement() === "beside"
      ? (dragShare() ?? besideShare())
      : rightPanel.codeTabTreeSize();
  const storeBeside = (n: number) => {
    if (inBand(n)) setBesideShare(n);
  };
  return {
    layout: () => LAYOUT[arrangement()],
    sizes: controlledSizes(() => [share(), 1 - share()]),
    // Corvu calls this from inside its own effect: read untracked, so the
    // effect does not come to depend on the arrangement or the drag.
    onSizesChange: (sizes) =>
      untrack(() => {
        const s = realSizes(sizes);
        if (!s || Math.abs(s[0] - share()) <= ECHO) return;
        if (arrangement() === "stacked") rightPanel.setCodeTabTreeSize(s[0]);
        else if (pointerDrag) setDragShare(s[0]);
        else storeBeside(s[0]);
      }),
    // Fires on each pointer move of a drag, never for a key.
    onHandleDrag: () => {
      pointerDrag = true;
    },
    onHandleDragEnd: () => {
      pointerDrag = false;
      const reached = dragShare();
      if (reached === null) return;
      batch(() => {
        storeBeside(reached);
        setDragShare(null);
      });
    },
  };
}
