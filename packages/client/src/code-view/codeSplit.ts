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
 *  Corvu re-emits the sizes it was handed (on mount, and when they change); an
 *  emission equal to what it was handed is an echo and writes nothing. */

import { type Accessor, createSignal } from "solid-js";
import { defaultInvalidWarning, persistedPref } from "../persistedPref";
import {
  MIN_CODE_PANE_SHARE,
  useRightPanel,
} from "../right-panel/useRightPanel";
import { controlledSizes, twoPanelSplit } from "../ui/corvuResizable";

/** Tree above the file, or tree left of the file. */
export type CodeArrangement = "stacked" | "beside";

/** The narrowest box that stands the tree beside the file. At the default
 *  share (0.3) it is the first round width where the tree keeps the works
 *  sidebar's own floor of 192px (0.3 × 720 = 216px) and the file keeps the
 *  480px the Right panel gives it in a 1920px window (0.7 × 720 = 504px).
 *  Every phone and small tablet is under it, so they keep the stacked view. */
const BESIDE_MIN_WIDTH_PX = 720;

/** How a box `widthPx` wide arranges the view. */
export function codeArrangement(widthPx: number): CodeArrangement {
  return widthPx >= BESIDE_MIN_WIDTH_PX ? "beside" : "stacked";
}

/** Where the side-by-side share is kept, and its default. */
const BESIDE_SHARE = {
  name: "kolu-code-tab-beside-tree-size",
  fallback: 0.3,
} as const;

const inBand = (n: number) =>
  n >= MIN_CODE_PANE_SHARE && n <= 1 - MIN_CODE_PANE_SHARE;

const [besideShare, setBesideShare] = persistedPref<number>({
  name: BESIDE_SHARE.name,
  fallback: BESIDE_SHARE.fallback,
  // Only a JSON number in the band: anything else reads as the default, and
  // says so in the console.
  parse: (raw) => {
    const n: unknown = JSON.parse(raw);
    if (typeof n !== "number" || !inBand(n)) {
      throw new Error(`invalid side-by-side tree share: ${raw}`);
    }
    return n;
  },
  onInvalid: defaultInvalidWarning(BESIDE_SHARE.name, BESIDE_SHARE.fallback),
});

/** What each arrangement hands Corvu: its orientation, and the tree's edge
 *  that meets the handle. The handle's look follows the orientation
 *  (`RESIZE_HANDLE_CLASS`). */
const LAYOUT = {
  stacked: { orientation: "vertical", treeEdge: "border-b" },
  beside: { orientation: "horizontal", treeEdge: "border-e" },
} as const;

/** The split for a view arranged as `arrangement` says: Corvu's orientation
 *  and the tree's edge (`layout`), its controlled `sizes` (the tree's share,
 *  then the file's) and the callbacks that write the share. Call from a
 *  component body. */
export function createCodeSplit(arrangement: Accessor<CodeArrangement>) {
  const rightPanel = useRightPanel();
  // A pointer drag in flight, beside: the share it has reached, not yet
  // stored; null when no pointer is dragging. Kept TWICE on purpose — the
  // signal is what the sizes below are derived from, and `dragging` is what
  // the three callbacks decide on. A setter's value is only visible on the
  // next microtask, and Corvu reports its new sizes within the very pointer
  // event that opened the drag, so a read of the signal there would still
  // answer "no drag" and store a share on every pointer move.
  let dragging: number | null = null;
  const [dragShare, setDragShare] = createSignal<number | null>(null);
  const setDrag = (reached: number | null) => {
    dragging = reached;
    setDragShare(reached);
  };
  const storeBeside = (n: number) => {
    if (inBand(n)) setBesideShare(n);
  };
  // What Corvu was last handed, recorded as it is derived: the memo's value
  // IS what the caller passes to `<Resizable sizes=…>`. Corvu reports sizes
  // back from inside its OWN effect callback, where reading a signal or a memo
  // is STRICT_READ_UNTRACKED — so the report below is judged against these
  // plain fields rather than against a share derived at report time.
  let handed: { arrangement: CodeArrangement; share: number } | null = null;
  const sizes = controlledSizes(() => {
    const now = arrangement();
    const share =
      now === "beside"
        ? (dragShare() ?? besideShare())
        : rightPanel.codeTabTreeSize();
    handed = { arrangement: now, share };
    return [share, 1 - share];
  });
  return {
    layout: () => LAYOUT[arrangement()],
    sizes,
    onSizesChange: (next: number[]) => {
      const held = handed;
      // Nothing handed over yet: there is no layout of ours for this to be a
      // report about.
      if (held === null) return;
      const s = twoPanelSplit(next);
      // Compare with what Corvu holds, not with a share derived now: when
      // the arrangement changes inside an effect pass, Corvu emits its old
      // sizes before it is handed the new ones.
      if (!s || s[0] === held.share) return;
      if (held.arrangement === "stacked") rightPanel.setCodeTabTreeSize(s[0]);
      else if (dragging !== null) setDrag(s[0]);
      else storeBeside(s[0]);
    },
    // Fires on each pointer move of a drag, before Corvu resizes, and never
    // for a key: the first one opens the drag at the share it starts from.
    onHandleDrag: () => {
      if (arrangement() === "beside" && dragging === null)
        setDrag(besideShare());
    },
    onHandleDragEnd: () => {
      if (dragging === null) return;
      storeBeside(dragging);
      setDrag(null);
    },
  };
}
