/** THE dock row — the full two-line terminal row kolu's Dock is built from, and
 *  the thing this package exists to hand a fleet mirror whole.
 *
 *    Line 1: `indicator · annotation · recency`
 *    Line 2: `[PR pip] status words`   (branch col → end)
 *
 *  One leading status indicator (`StatePip`) folds identity · paint · motion ·
 *  unread into one glyph; the annotation column starts at col 2, and line 2's
 *  flex row is anchored to that same column so PR icons align across every
 *  section. The active row gets a quiet highlight and the attention wash fills
 *  the 5 px stripe the row already reserves — geometry never changes, so the
 *  dock does not reflow when a row lights up.
 *
 *  ONE component, two densities. `Dock.tsx` (desktop) and `DockList.tsx` (the
 *  touch drawer / compact rail) used to be two hand-kept copies of this markup
 *  linked by a comment reading "Update both files when row geometry changes" —
 *  the divergence axes they cited (tap sizing, the drag-to-dismiss pointer trap,
 *  the desktop-only ⌘N hint) are the four props below, not a second component.
 *
 *  What is REQUIRED here is the whole visible row: pip, annotation, status
 *  words, recency, the PR badge, the repo stripe, the sleeping recede. What is
 *  OPTIONAL is what a consumer may simply not have — an active tile
 *  (`active`), an overlay affordance (`overlay`), e2e handles (`testIds`), a
 *  hover title, a pointer trap. Each defaults to off with no visual damage; none
 *  of them is a degraded rendering of something that should have been there.
 *
 *  Row is `<div role="button">` rather than `<button>` so the `<a>` PR pip on
 *  line 2 stays valid HTML. Nested interactive elements (`<a>` inside
 *  `<button>`) produce unreliable keyboard / screen-reader behaviour; the
 *  div+role pattern keeps the row activatable via mouse, Enter and Space
 *  without that nesting. Biome's a11y rule wants a native `<button>`, but that
 *  is exactly what we cannot use — the PR pip must remain a real link
 *  (Cmd-click, context menu) and HTML forbids `<a>` inside `<button>`. */

import { StatePip } from "@kolu/solid-statepip";
import {
  DOCK_ROW_PIP_BOX,
  SLEEPING_RECEDE_CLASS,
} from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PrInfo } from "anyforge/schemas";
import { type Component, type JSX, Show } from "solid-js";
import {
  DOCK_CARDS_SUBGRID_LEFT_RESTORE,
  DOCK_ROW_BRANCH_COL,
  DOCK_ROW_SURFACE,
  DOCK_ROW_STRIPE_CLASS,
  type DockRowSurface,
} from "./geometry.ts";
import type { DockRowBucket, StatePipBind } from "./pipBind.ts";
import { PrPip } from "./PrPip.tsx";
import { RecencyCell, type RowRecency } from "./RecencyCell.tsx";
import { dockRowAttrs } from "./rowAttrs.ts";
import { RowLabel } from "./RowLabel.tsx";
import type { RowSubline } from "./rowSubline.ts";

/** The DOM handles a consuming surface stamps on its rows, so its own e2e suite
 *  can select them. Absent means no `data-testid` at all — an honest "this
 *  surface stamps no handles", not a shared default two surfaces would collide
 *  on. Supplied as ONE bag so a surface cannot name its row and forget its
 *  sublines. */
export type DockRowTestIds = {
  /** The row element. */
  row: string;
  /** The subline when it carries an AGENT's words. */
  agentSubline: string;
  /** The subline when it carries a foreground process title. */
  quietSubline: string;
};

export type DockRowProps = {
  id: TerminalId;
  /** How much room the row has — the ONE axis desktop and touch differ by. */
  surface: DockRowSurface;
  /** The bound status indicator. `asking`, `sleeping` and the unread `alert`
   *  are read OFF this rather than repeated as sibling props: they are the same
   *  facts the pip is painted from, and a row that took them twice is a row
   *  whose wash and whose pip could disagree. */
  pip: StatePipBind;
  /** The ORDER bucket (`data-bucket`) — ordering tests, the rail glow. */
  bucket: DockRowBucket;
  /** The agent state VERBATIM (`data-agent-state`). A plain `string`: a
   *  consumer whose wire carries it as text narrows the closed literal out with
   *  `narrowAgentState` and passes the raw word here, known or not. */
  agentState: string | undefined;
  /** The annotation line as markdown source — intent line 1, else the branch. */
  label: string;
  /** The per-branch annotation ink. */
  labelColor: string;
  /** Renders `label`. Required and injected — see `RowLabel`. */
  renderLabel: (markdown: string) => JSX.Element;
  /** The status words on line 2, and whether they are an agent's. */
  subline: RowSubline;
  /** The row's pull request, or `null`. */
  pr: PrInfo | null;
  /** The recency rendering and the string computed for it. */
  recency: RowRecency;
  onSelect: () => void;
  /** The row the user is LOOKING at. Optional: a surface with no notion of an
   *  active tile never sets it. */
  active?: boolean;
  /** An absolutely-positioned affordance over the row — kolu's ⌘N shortcut
   *  hint. The row is the positioning context for it. */
  overlay?: JSX.Element;
  testIds?: DockRowTestIds;
  /** Hover title. */
  title?: string;
  /** A pointer-down trap. kolu's touch drawer stops propagation here so Corvu's
   *  drag-to-dismiss cannot claim the tap. */
  onPointerDown?: (event: PointerEvent) => void;
};

export const DockRow: Component<DockRowProps> = (props) => {
  const s = () => DOCK_ROW_SURFACE[props.surface];
  return (
    // biome-ignore lint/a11y/useSemanticElements: native button would nest invalid interactive HTML — see the module header
    <div
      role="button"
      tabIndex={0}
      data-testid={props.testIds?.row}
      // The shared row contract (`dockRowAttrs`) — wash hook, bucket, agent
      // state, active/asking/unread. Attention washes key on the ATTENTION
      // class, not the ORDER bucket: the wash, the chip, the header count and
      // its jump are one fact rendered four ways.
      {...dockRowAttrs({
        id: props.id,
        bucket: props.bucket,
        agentState: props.agentState,
        asking: props.pip.asking,
        unread: props.pip.alert,
        active: props.active ?? false,
      })}
      data-sleeping={props.pip.sleeping ? "" : undefined}
      // Attached only when a surface actually traps the gesture. Registering a
      // no-op listener on every row is a real DOM delta the desktop row did not
      // have before the extraction, and "it does nothing" is not the same as
      // "it is not there".
      onPointerDown={props.onPointerDown}
      onClick={() => props.onSelect()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect();
        }
      }}
      class={`relative w-full grid grid-cols-subgrid col-span-full items-center ${s().rowPad} ${DOCK_CARDS_SUBGRID_LEFT_RESTORE} ${s().rowGutter} ${DOCK_ROW_STRIPE_CLASS} text-left cursor-pointer transition-colors duration-150 ${s().rowFocus} ${s().rowPress}`}
      classList={{ [SLEEPING_RECEDE_CLASS]: props.pip.sleeping }}
      title={props.title}
    >
      {/* Identity status indicator — one binder shared with title/list. */}
      <span class="row-span-2 flex self-center">
        <StatePip {...props.pip} class={DOCK_ROW_PIP_BOX} />
      </span>
      <RowLabel
        markdown={props.label}
        render={props.renderLabel}
        class={s().textLabel}
        color={props.labelColor}
      />
      {/* Recency — hidden while active; width reserved. On a blocked row it
       *  flips to the violet WAIT chip: how long the agent has waited on you IS
       *  the signal (a 20 h wait must be legible). */}
      <RecencyCell recency={props.recency} textSize={s().textRecency} />
      {props.overlay}
      {/* Second line — flex row spanning the annotation column → end. Leads
       *  with the PR pip (left edge anchored to the annotation column's left, so
       *  PR icons align across every section) followed by the status words, or
       *  an invisible placeholder keeping the row two lines tall. */}
      <div
        class={`${DOCK_ROW_BRANCH_COL} col-end-[-1] flex items-center gap-1.5 min-w-0 mt-0.5`}
      >
        <PrPip pr={props.pr} />
        <Show
          when={props.subline.text}
          fallback={
            <span
              aria-hidden="true"
              class={`font-mono ${s().textSubline} leading-tight invisible`}
            >
              &nbsp;
            </span>
          }
        >
          {(line) => (
            <span
              data-testid={
                props.subline.fromAgent
                  ? props.testIds?.agentSubline
                  : props.testIds?.quietSubline
              }
              // The shared subline hook every row surface carries, so the
              // blocked-row colour rule is ONE selector instead of an
              // enumeration of test ids per surface — the same enumeration that
              // silently left a row type out of the wash. Set only on the AGENT
              // subline: a quiet foreground line does not speak needs-you.
              data-dock-subline={props.subline.fromAgent ? "" : undefined}
              class={`font-mono ${s().textSubline} leading-snug text-fg-3 truncate min-w-0`}
              title={line()}
            >
              {line()}
            </span>
          )}
        </Show>
      </div>
    </div>
  );
};
