/** THE dock row — the full two-line terminal row kolu's Dock is built from, and
 *  the thing this package exists to hand a fleet mirror whole.
 *
 *    Line 1: `indicator · annotation · recency`
 *    Line 2: `[PR pip] status words · model`   (branch col → end)
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
 *  words, the model tag, recency, the PR badge, the repo stripe, the sleeping
 *  recede. What is OPTIONAL is what a consumer may simply not have — an active
 *  tile (`active`), an overlay affordance (`overlay`), e2e handles (`testIds`),
 *  a hover title, a pointer trap. Each defaults to off with no visual damage;
 *  none of them is a degraded rendering of something that should have been
 *  there.
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
  DOCK_ROW_GAP,
  DOCK_ROW_GRID,
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
  /** The model the live agent's SESSION is running on, or `undefined` — no
   *  live agent, or a session that has not named one yet. Rendered as the quiet
   *  tag at the END of line 2: the status words say *doing what*, this says *on
   *  what*. A session fact, not a per-event one: a producer that read it off
   *  the newest transcript event blanked it on every tool result, which the
   *  tag's whole "sweep the rows' right edge" premise cannot survive. Both
   *  absences draw nothing, rather than an "unknown" that would be noise on
   *  every shell row. */
  model: string | undefined;
  /** The annotation line as markdown source — intent line 1, else the branch. */
  label: string;
  /** The per-branch annotation ink — `undefined` on a row that has no display
   *  identity of its own (a split's label is its cwd basename, not a branch). */
  labelColor: string | undefined;
  /** Renders `label`. Required and injected — see `RowLabel`. */
  renderLabel: (markdown: string) => JSX.Element;
  /** The status words on line 2, and whether they are an agent's. */
  subline: RowSubline;
  /** The row's pull request, or `null`. */
  pr: PrInfo | null;
  /** The recency rendering and the string computed for it. */
  recency: RowRecency;
  /** The terminal this row hangs under — a SPLIT's real parent, which may
   *  itself be a split. Absent on a top-level row. Stamps `data-parent-id`, the
   *  handle the dock's own tests navigate the tree by. */
  parentId?: TerminalId;
  /** Hops from the top-level tile: 1 for a split, 2 for a split of a split.
   *  Absent on a top-level row. Stamps `data-depth`, and steps the row's TEXT
   *  block in one notch per hop — see the label cell below for why the indent
   *  lives there and not on the row. */
  depth?: number;
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

/** How far a nested row steps in per hop: 1.25rem clears the `└` marker with a
 *  gap, and every hop past the first adds 0.75rem. */
function treeIndent(depth: number): string {
  return `${1.25 + (depth - 1) * 0.75}rem`;
}

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
      {...dockRowAttrs(props)}
      data-sleeping={props.pip.sleeping ? "" : undefined}
      // The nest's two facts, stamped where the rest of the row's contract is.
      // A split's entry is a FLAT sibling in the DOM (the section's grid), so
      // the tree exists as attributes and an indented text block.
      data-parent-id={props.parentId}
      data-depth={props.depth}
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
      class={`relative grid col-span-full items-center ${s().rowPad} ${DOCK_CARDS_SUBGRID_LEFT_RESTORE} ${s().rowGutter} ${DOCK_ROW_STRIPE_CLASS} text-left cursor-pointer transition-colors duration-150 ${s().rowFocus} ${s().rowPress} ${
        props.depth === undefined
          ? "w-full grid-cols-subgrid"
          : `${DOCK_ROW_GRID} ${DOCK_ROW_GAP}`
      }`}
      // A nested row indents by insetting its own tracks, and it CANNOT do that
      // as a subgrid item: a subgrid shares the parent's lines, so padding the
      // row slides only its first cell out from under the rest (measured —
      // label and recency stayed put while the indicator moved). So a nested row
      // declares the section's own tracks for itself, from the same two
      // constants the section builds its template from, and pads the left:
      // indicator, label and line 2 step in together, and the recency column
      // still lands on the section's right edge.
      //
      // It also drops `w-full` in that branch, and that is not cosmetic either:
      // `width: 100%` resolves against the grid area in a way the bleeds then
      // double-count, so the box came out one gutter short (264 vs the parent's
      // 288) and the row's whole right side — background, recency, model —
      // stopped 24px inside the card. An auto width stretches to the area and
      // lets `-ml-3`/`-mr-3` do the bleeding, which lands exactly on the
      // parent's box. Both numbers are measured, not reasoned.
      style={
        props.depth === undefined
          ? undefined
          : { "padding-left": `calc(0.75rem + ${treeIndent(props.depth)})` }
      }
      classList={{ [SLEEPING_RECEDE_CLASS]: props.pip.sleeping }}
      title={props.title}
    >
      {/* The tree marker — a split's row sits directly under its parent in a
       *  flat sibling list, so this glyph is what says "child". Decorative:
       *  `data-depth` carries the fact, and the indent carries the depth. It
       *  sits just left of the indicator, inside the padding the indent
       *  created. */}
      <Show when={props.depth}>
        {(depth) => (
          <span
            aria-hidden="true"
            class="absolute top-1/2 -translate-y-1/2 font-mono text-[0.6rem] leading-none text-fg-3/70 select-none"
            style={{ left: `calc(0.75rem + ${treeIndent(depth())} - 0.9rem)` }}
          >
            └
          </span>
        )}
      </Show>
      {/* Identity status indicator — one binder shared with title/list. */}
      <span class="row-span-2 flex self-center">
        <StatePip {...props.pip} class={DOCK_ROW_PIP_BOX} />
      </span>
      <RowLabel
        markdown={props.label}
        render={props.renderLabel}
        // No ink means "this row has no display identity of its own" (a split's
        // label is a directory, not a branch) — which is the dock's quiet
        // secondary ink, NOT an inherited default. Inheriting gave the nested
        // row the app's heaviest text and made it shout over its parent.
        class={`col-start-2 ${s().textLabel} ${props.labelColor === undefined ? "text-fg-2" : ""}`}
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
        {/* The model — `ml-auto` puts it in the column the recency cell owns
         *  on line 1, so a sweep down the rows' right edge reads what every
         *  agent is running on. `shrink-0` + a `max-w` cap means the WORDS
         *  yield first (they already truncate, and a summary is what the
         *  tooltip is for), and a harness reporting a long pinned id
         *  (`claude-sonnet-4-5-20250929`) ellipsises in its own half-width
         *  slot rather than pushing the words out or wrapping the row. */}
        <Show when={props.model}>
          {(model) => (
            <span
              data-dock-model=""
              title={model()}
              class={`ml-auto shrink-0 max-w-[50%] truncate font-mono ${s().textSubline} leading-snug text-fg-3/60`}
            >
              {model()}
            </span>
          )}
        </Show>
      </div>
    </div>
  );
};
