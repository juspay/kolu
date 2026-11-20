import { StatePip } from "@kolu/solid-statepip";
import {
  DOCK_ROW_PIP_BOX,
  SLEEPING_RECEDE_CLASS,
} from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PrInfo } from "anyforge/schemas";
import { type Component, type JSX, Show } from "solid-js";
import type { DockDragHandlers } from "./DockSection.tsx";
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
  pip: StatePipBind;
  /** The ORDER bucket (`data-bucket`) — ordering tests, the rail glow. */
  bucket: DockRowBucket;
  /** The agent state VERBATIM (`data-agent-state`). A plain `string`: a
   *  consumer whose wire carries it as text narrows the closed literal out with
   *  `narrowAgentState` and passes the raw word here, known or not. */
  agentState: string | undefined;
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
  /** The row ROOT as a node for the consumer's drag library — solid-dnd's
   *  `setNodeRef` (droppable target), same socket shape `DockSection` and
   *  `DockCluster` carry. Solid calls a `ref` function with the element. */
  ref?: (el: HTMLElement) => void;
  /** The consumer's drag ACTIVATORS for the row's own grip (solid-dnd's
   *  `dragActivators`, or any pointer-sensor's dict). Supplying it makes the
   *  PACKAGE render the grip; omitting it renders no grip at all — a touch row
   *  has no mouse drag, and a row whose terminal is not live has nothing to
   *  re-home. */
  handle?: DockDragHandlers;
  /** The drop verdict the consumer's drag library is currently holding over
   *  this row: `over` (a valid re-home target) or `invalid` (drop would be
   *  refused). Stamps `data-drop`, which `dockrow.css` paints. */
  drop?: "over" | "invalid";
};

function treeIndent(depth: number): string {
  return `${1.25 + (depth - 1) * 0.75}rem`;
}

function gripHandlers(handle: DockDragHandlers): DockDragHandlers {
  return Object.fromEntries(
    Object.entries(handle).map(([key, fn]) => [
      key,
      (event: Event) => {
        event.stopPropagation();
        fn(event);
      },
    ]),
  );
}

export const DockRow: Component<DockRowProps> = (props) => {
  const s = () => DOCK_ROW_SURFACE[props.surface];
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <button> cannot legally contain the PR pip's <a>
    <div
      role="button"
      tabIndex={0}
      ref={props.ref}
      data-testid={props.testIds?.row}
      {...dockRowAttrs(props)}
      data-sleeping={props.pip.sleeping ? "" : undefined}
      data-parent-id={props.parentId}
      data-depth={props.depth}
      data-drop={props.drop}
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
      <Show when={props.handle}>
        {(h) => (
          <button
            type="button"
            data-testid="dock-row-grip"
            tabIndex={-1}
            aria-label="Drag to nest this terminal"
            class="dock-row-grip"
            {...gripHandlers(h())}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </Show>
      <span class="row-span-2 flex self-center">
        <StatePip {...props.pip} class={DOCK_ROW_PIP_BOX} />
      </span>
      <RowLabel
        markdown={props.label}
        render={props.renderLabel}
        class={`col-start-2 ${s().textLabel} ${props.labelColor === undefined ? "text-fg-2" : ""}`}
        color={props.labelColor}
      />
      <RecencyCell recency={props.recency} textSize={s().textRecency} />
      {props.overlay}
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
              data-dock-subline={props.subline.fromAgent ? "" : undefined}
              class={`font-mono ${s().textSubline} leading-snug text-fg-3 truncate min-w-0`}
              title={line()}
            >
              {line()}
            </span>
          )}
        </Show>
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
