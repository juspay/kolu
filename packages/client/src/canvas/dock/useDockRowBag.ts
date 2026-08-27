/** The nine props a dock row takes that BOTH kolu surfaces answer identically —
 *  assembled once per row, as GETTERS.
 *
 *  `Dock.tsx` and `DockList.tsx` are one component now, but their CALL SITES had
 *  become the new copy: the same `useStatePip` block and the same nine prop
 *  bindings, byte for byte, in two files with nothing holding them together.
 *
 *  TWO THINGS ABOUT THE SHAPE, both load-bearing, both learned the hard way when
 *  the first version of this file got them wrong:
 *
 *  1. **It is called ONCE per row, from inside the `<Show>` callback** — never
 *     from a JSX spread position. `useStatePip` is a `createMemo`, and a memo
 *     belongs to the owner alive when it is created. A bag function invoked
 *     from `{...bag({…})}` is re-entered every time the spread is read, which
 *     either mints a fresh memo per read (they accumulate on the row's owner
 *     until unmount) or freezes the row at first paint. The old per-call-site
 *     code created the memo once and read `pip()` in JSX; this keeps that and
 *     only moves where the assembly is spelled.
 *
 *  2. **Every field is a GETTER, and the inputs arrive as accessors.** A plain
 *     object of VALUES read once is a snapshot: the wait chip stops counting,
 *     the pip stops repainting, `data-active` freezes on whichever tile was
 *     active at mount. Solid's `mergeProps` preserves property descriptors
 *     through a spread, so getters here stay reactive at the row's own prop
 *     reads — exactly as `pip()` in JSX used to be.
 *
 *  What is assembled is what the two surfaces agree on. What stays at each call
 *  site is what they genuinely differ by: the surface token, the landing verb
 *  (`tileStore.activate` centres the tile on the canvas; the drawer focuses
 *  silently and dismisses itself), the e2e handles, the desktop-only ⌘N overlay,
 *  and the touch-only pointer trap.
 *
 *  Three of the nine come from `dockRowFacts` — the row package's own fused read
 *  of one terminal record — so a row's words and its PR cannot come from two
 *  different terminals. */

import type { DockRowProps } from "@kolu/solid-dockrow";
import { dockRowFacts } from "@kolu/solid-dockrow/rowValues";
import type { TerminalMetadata } from "@kolu/padi-client/vocab";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { type DockRowBucket, rowRecencyAt } from "./dockRowRanking";
import { renderRowLabel } from "./renderRowLabel";
import { useRowRecency } from "./rowRecency";

/** The subset of `DockRowProps` both surfaces answer the same way. */
export type SharedDockRowProps = Pick<
  DockRowProps,
  | "id"
  | "pip"
  | "bucket"
  | "agentState"
  | "active"
  | "label"
  | "labelColor"
  | "renderLabel"
  | "subline"
  | "pr"
  | "recency"
>;

/** Build the shared half of a row's props. Call from a component body; call the
 *  returned function ONCE per row, inside the `<Show>` that has the record. */
export function useDockRowBag(): (input: {
  id: TerminalId;
  /** The live record and its slow display projection, already paired. */
  combined: Accessor<{ info: TerminalDisplayInfo; meta: TerminalMetadata }>;
  /** The ORDER bucket — `data-bucket`. */
  bucket: Accessor<DockRowBucket>;
  /** The PIP bucket the dock's ranking pass already computed. */
  pipBucket: Accessor<DockRowBucket>;
  /** Newest activity in the whole tile, including its splits. */
  recencyAt: Accessor<number | null>;
}) => SharedDockRowProps {
  const store = useTerminalStore();
  const rowRecency = useRowRecency();
  return (input) => {
    // ONE memo per row, created here in the row's own owner — see note 1.
    const pip = useStatePip(
      encActiveHost,
      () => input.id,
      () => input.combined().meta,
      () => store.isUnread(input.id),
      input.pipBucket,
    );
    // MEMOIZED, and this is the "once per row" case rather than the per-read one
    // note 1 warns about: the bag runs inside the <Show> owner where
    // `useStatePip`'s memo already lives, so the lifetime is the same.
    //
    // Not a micro-optimisation. `dockRowFacts` derives agentState, subline AND
    // pr from one record, and `agentState` is read inside the `dockRowAttrs`
    // spread — a render effect. Computing the other two in that effect
    // subscribed it to `arm.pr.*` and `arm.foreground.title`, so a PR resolving,
    // or the foreground title changing on EVERY command the user runs, rewrote
    // all seven data-* attributes. The memo is the boundary that keeps the
    // attribute effect tracking only what it renders.
    const facts = createMemo(() => dockRowFacts(input.combined().meta));
    return {
      id: input.id,
      get pip() {
        return pip();
      },
      get bucket() {
        return input.bucket();
      },
      get agentState() {
        return facts().agentState;
      },
      get active() {
        return isActiveRow(input.id);
      },
      get label() {
        return annotationLine(
          input.combined().meta.intent,
          input.combined().info.key.label,
        );
      },
      get labelColor() {
        return input.combined().info.annotationColor;
      },
      renderLabel: renderRowLabel,
      get subline() {
        return facts().subline;
      },
      get pr() {
        return facts().pr;
      },
      get recency() {
        return rowRecency(
          pip(),
          input.recencyAt(),
          rowRecencyAt(input.combined().meta),
        );
      },
    };
  };
}
