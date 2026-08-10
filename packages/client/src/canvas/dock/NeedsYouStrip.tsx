/** The dock's pinned **needs-you strip** — every terminal whose agent is
 *  blocked on you, in a fixed place above the repo sections.
 *
 *  This is how attention reaches you now that no dock surface sorts on a clock
 *  (`dockTree.ts`). The old design floated a blocked row to the top of its
 *  section, which surfaced it — and reflowed the list around it, on a schedule
 *  nobody controls. The strip keeps the surfacing and drops the reflow: an
 *  entry here MIRRORS a row that is still sitting in its own structural slot
 *  below, wearing its own `Cmd+N` number. Clicking either goes to the same
 *  place.
 *
 *  Renders NOTHING when nothing is blocked, which is the common case — the
 *  strip is a state the dock enters, not furniture it carries.
 *
 *  Deliberately not a filter toggle and not dismissible: the only thing that
 *  empties this strip is the agent leaving `awaiting_user`, the same rule the
 *  violet capsule has always followed. */

import { StatePip } from "@kolu/solid-statepip";
import { DOCK_ROW_PIP_BOX } from "@kolu/solid-statepip/pipVariant";
import { activeArm } from "@kolu/padi/surface";
import { DASH, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { useDuration } from "../../terminal/staleness";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { createDockRowData } from "./dockRowData";
import { dockRowAttrs } from "./dockRowAttrs";
import { rowRecencyAt } from "./dockRowRanking";
import type { DockNeedsYouEntry } from "./dockTree";
import RecencyCell, { displayRecencyAt, recencyMode } from "./RecencyCell";

/** How much of an entry there is room for. Named for the axis, not for the
 *  caller: `DockList` IS the compact layout's persistent left rail and takes
 *  `"full"`, because what the desktop dock's rail mode really means here is
 *  "44 px, icons only". A `rail: boolean` read backwards at one of its two call
 *  sites. */
export type NeedsYouDensity = "icon" | "full";

/** One mirrored entry.
 *
 *  Two rows ride on it, and keeping them apart is the point. The **tile** is
 *  what you click and what the label names — a split has no dock row of its
 *  own to land on. The **blocked** row is what the pip, the violet wait capsule
 *  and the shared row attributes come off: when a split is the one asking, the
 *  parent's own pip paints `ago`/`hidden` and its `ts` is the tile-wide fold, so
 *  painting the parent gave the strip an entry with no capsule at all under a
 *  heading reading "Needs you", and a tooltip reporting a chattier sibling's
 *  three seconds as the blocked agent's twenty hours.
 *
 *  It reads the same pip binding and the same recency cell the structural row
 *  does, so the two renderings of one terminal cannot drift — the whole point
 *  of a mirror is that it agrees with what it mirrors. */
const NeedsYouEntryRow: Component<{
  entry: DockNeedsYouEntry;
  density: NeedsYouDensity;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const tileData = createDockRowData(props.entry.tile.id);
  // The blocked half gives METADATA only. `getDisplayInfo` is keyed on
  // `terminalIds()` — TOP-LEVEL tiles — so it answers `undefined` for any split,
  // and `pairDisplayRow` turns that into `null`. Asking it for a split's display
  // row therefore made the whole entry render NOTHING: the strip silently
  // dropped the split-blocked agent, which is the exact case this pair exists
  // for. `SubTerminalRow`, the other surface that renders a split, reads only
  // `getMetadata` for the same reason — a split has no display identity of its
  // own, which is precisely WHY the entry carries a tile beside it.
  const blockedMeta = () => store.getMetadata(props.entry.blocked.id);
  const unread = () => store.isUnread(props.entry.blocked.id);
  const combined = createMemo(() => {
    const tile = tileData();
    const blocked = blockedMeta();
    return tile && blocked ? { tile, blocked } : null;
  });
  return (
    <Show when={combined()}>
      {(c) => {
        const pip = useStatePip(
          encActiveHost,
          () => props.entry.blocked.id,
          () => c().blocked,
          unread,
          () => props.entry.blocked.pip,
        );
        const mode = () => recencyMode(pip());
        // The blocked row's OWN wait, never the tile-wide fold. A sub-row's
        // `ts` already IS its own recency, and so is `rowRecencyAt` of its
        // metadata — one expression covers both halves of the pair.
        const waitAt = () =>
          displayRecencyAt(
            mode(),
            props.entry.tile.ts,
            rowRecencyAt(c().blocked),
          );
        // The EXACT string the violet capsule shows, for the icon density's
        // tooltip — `useDuration`, not `formatTimeAgo`. The two are not
        // interchangeable: `formatTimeAgo` answers "20h ago", which composes
        // into "waiting on you for 20h ago". A duration is what belongs after
        // "for", and it is the same reading the full density renders, so the
        // two densities cannot report different waits.
        //
        // `formatDuration` answers the dash on clock skew and the clock is
        // absent for a never-active row — both deliberate "nothing honest to
        // report" answers, so the clause DROPS rather than inventing one.
        const duration = useDuration();
        const waitLabel = () => {
          const at = waitAt();
          if (at === null) return "";
          const d = duration(at);
          return d === DASH ? "" : d;
        };
        const title = () => {
          const where = `${c().tile.info.key.group} · ${c().tile.info.key.label}`;
          const wait =
            props.density === "icon" && waitLabel()
              ? ` for ${waitLabel()}`
              : "";
          const hidden = props.entry.hiddenByFilter
            ? " (hidden by the dock filters)"
            : "";
          return `${where} — waiting on you${wait}${hidden}`;
        };
        return (
          <button
            type="button"
            data-testid="dock-needs-you-entry"
            // The SHARED row contract, not a fourth hand-spelling of it. The
            // strip used to carry none of it, so the one surface literally
            // named "Needs you" was the one dock surface outside the
            // `[data-asking]` wash vocabulary — and it failed silently, by
            // rendering plainer than every other row.
            {...dockRowAttrs({
              id: props.entry.blocked.id,
              bucket: props.entry.blocked.bucket,
              agentState: activeArm(c().blocked)?.agent?.state,
              asking: pip().asking,
              unread: unread(),
            })}
            // The tile this entry lands on — distinct from `data-terminal-id`
            // above, which names the row the pip and the wait come off.
            data-tile-id={props.entry.tile.id}
            // A row the dock's own filters removed from the sections below. It
            // still belongs here (that is the twenty-hour case), so the mark is
            // deliberately quiet — a slight recede, not a second badge.
            data-filtered-hidden={props.entry.hiddenByFilter ? "" : undefined}
            // The BLOCKED id, not the tile. When a split is the one asking, this
            // entry names that split — its pip, its wait, its `data-terminal-id`
            // — so landing on the parent's MAIN pane would send you to a pane
            // that is not waiting: the strip would name one agent and navigate
            // to another, the same lie as painting the wrong clock. Every host's
            // verb resolves a split to its tab (`focusTerminal` /
            // `focusTerminalSilently`, the same landing `SubTerminalRow` and the
            // section-header capsule use). For an ordinary row
            // `blocked.id === tile.id`, so nothing else changes.
            onClick={() => props.onSelect(props.entry.blocked.id)}
            // The icon density is 44px, so it drops the label and the wait
            // capsule and shows the pip alone. The duration is the reason to
            // glance at this strip at all, so it rides in the tooltip rather
            // than being lost — an unlabelled band of pips is not the feature.
            title={title()}
            class={`flex items-center gap-1.5 w-full rounded-md cursor-pointer text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
              props.density === "icon" ? "justify-center py-1" : "px-1.5 py-1"
            }`}
            classList={{ "opacity-70": props.entry.hiddenByFilter }}
          >
            <StatePip {...pip()} class={DOCK_ROW_PIP_BOX} />
            <Show when={props.density === "full"}>
              <span
                class="flex-1 min-w-0 truncate text-[0.8rem]"
                style={{ color: c().tile.info.annotationColor }}
              >
                <IntentMarkdownInline
                  markdown={annotationLine(
                    c().tile.meta.intent,
                    c().tile.info.key.label,
                  )}
                />
              </span>
              {/* The violet wait capsule — how long it has been blocked. The
               *  one number that makes this strip worth glancing at, and the
               *  same cell the row below renders. */}
              <RecencyCell
                recencyAt={waitAt()}
                textSize="text-[0.6rem]"
                mode={mode()}
              />
            </Show>
          </button>
        );
      }}
    </Show>
  );
};

/** The strip itself — pinned above the scrollport so it cannot scroll out of
 *  reach, which is the difference between a fixed place and just another row.
 *
 *  `onSelect` is the HOST's, never this module's. The desktop dock centres the
 *  tile on its canvas; the phone drawer focuses silently and dismisses itself;
 *  the compact rail focuses silently and stays. Baking the desktop verb in here
 *  meant a phone tap left the 78vw drawer sitting over the agent it had just
 *  jumped to — and it failed silently, because the skipped step throws
 *  nothing. `DockList` already states this contract for its rows; the strip
 *  lives inside `DockList` too, so it owes the same. */
export const NeedsYouStrip: Component<{
  entries: readonly DockNeedsYouEntry[];
  density: NeedsYouDensity;
  onSelect: (id: TerminalId) => void;
}> = (props) => (
  <Show when={props.entries.length > 0}>
    <section
      data-testid="dock-needs-you-strip"
      aria-label="Agents waiting on you"
      class="dock-needs-you-strip shrink-0 flex flex-col gap-0.5 border-b border-edge/40 py-1"
      classList={{ "px-1": props.density === "full" }}
    >
      <Show when={props.density === "full"}>
        <span class="px-1.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.12em] text-fg-3">
          Needs you
        </span>
      </Show>
      <For each={props.entries}>
        {(entry) => (
          <NeedsYouEntryRow
            entry={entry}
            density={props.density}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </section>
  </Show>
);
