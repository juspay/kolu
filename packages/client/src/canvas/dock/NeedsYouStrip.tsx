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

import { activeArm } from "@kolu/padi-client/surface";
import { DockNeedsYouRow, DockNeedsYouStrip } from "@kolu/solid-dockrow";
import type { NeedsYouDensity } from "@kolu/solid-dockrow/rowValues";
import { DASH, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { annotationLine } from "../../intent/text";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { isActiveRow } from "./activeRow";
import { renderRowLabel } from "./renderRowLabel";
import { createDockRowData } from "./dockRowData";
import { rowRecencyAt } from "./dockRowRanking";
import type { DockNeedsYouEntry } from "./dockTree";
import { useRowRecency } from "./rowRecency";

// `NeedsYouDensity` — how much of an entry there is ROOM for — is the package's
// (`@kolu/solid-dockrow`), re-exported here because this module's two call sites
// name it. `DockList` IS the compact layout's persistent left rail and takes
// `"full"`, because what the desktop dock's rail mode really means is "44 px,
// icons only".
export type { NeedsYouDensity };

/** kolu's wiring for `@kolu/solid-dockrow`'s needs-you entry. Two terminals
 *  ride on one entry, split by what each can answer:
 *
 *  - **tile** — the DISPLAY IDENTITY (repo · branch, annotation colour,
 *    intent). A split has none of its own: `getDisplayInfo` is keyed on
 *    top-level tiles. That is the whole reason the pair exists.
 *  - **blocked** — what is asked, painted, timed and navigated to. When a split
 *    is the one asking, the parent's pip paints `ago`/`hidden` and its `ts` is
 *    the tile-wide fold, so reading the parent gave an entry with no violet
 *    capsule under a heading reading "Needs you", and a tooltip reporting a
 *    chattier sibling's three seconds as this agent's twenty hours.
 *
 *  It reads the same pip binding and the same recency fold the structural row
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
  // `getMetadata` for the same reason.
  const blockedMeta = () => store.getMetadata(props.entry.blocked.id);
  const unread = () => store.isUnread(props.entry.blocked.id);
  const combined = createMemo(() => {
    const tile = tileData();
    const blocked = blockedMeta();
    return tile && blocked ? { tile, blocked } : null;
  });
  const rowRecency = useRowRecency();
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
        // The blocked row's OWN wait, never the tile-wide fold. A sub-row's
        // `ts` already IS its own recency, and so is `rowRecencyAt` of its
        // metadata — one expression covers both halves of the pair.
        const recency = () =>
          rowRecency(pip(), {
            window: props.entry.tile.ts,
            own: rowRecencyAt(c().blocked),
          });
        const title = () => {
          const where = `${c().tile.info.key.group} · ${c().tile.info.key.label}`;
          const hidden = props.entry.hiddenByFilter
            ? " (hidden by the dock filters)"
            : "";
          // The wait rides the tooltip ONLY at icon density, where the capsule
          // has no room. The EXACT string the violet capsule shows, so the two
          // densities cannot report different waits — `recency().text` is the
          // duration, not `formatTimeAgo`'s "20h ago", which would compose into
          // "waiting on you for 20h ago". The dash (clock skew, or a never-
          // active row) is a deliberate "nothing honest to report", so the
          // clause DROPS rather than inventing one.
          if (props.density !== "icon") {
            return `${where} — waiting on you${hidden}`;
          }
          // `hidden` carries no text at all now — the union says so, rather
          // than a comment promising an empty string. An entry in this strip is
          // asking by construction, so it is always the wait chip; reading the
          // union honestly costs one narrow and removes the assumption.
          const r = recency();
          const d = r.mode === "hidden" ? "" : r.text;
          const wait = d && d !== DASH ? ` for ${d}` : "";
          return `${where} — waiting on you${wait}${hidden}`;
        };
        return (
          <DockNeedsYouRow
            // The BLOCKED id, not the tile. When a split is the one asking, this
            // entry names that split — its pip, its wait, its `data-terminal-id`
            // — so landing on the parent's MAIN pane would send you to a pane
            // that is not waiting: the strip would name one agent and navigate
            // to another, the same lie as painting the wrong clock. Every host's
            // verb resolves a split to its tab (the same landing `SubTerminalRow`
            // and the section-header capsule use). For an ordinary row
            // `blocked.id === tile.id`, so nothing else changes.
            id={props.entry.blocked.id}
            tileId={props.entry.tile.id}
            density={props.density}
            pip={pip()}
            bucket={props.entry.blocked.bucket}
            agentState={activeArm(c().blocked)?.agent?.state}
            active={isActiveRow(props.entry.blocked.id)}
            label={annotationLine(
              c().tile.meta.intent,
              c().tile.info.key.label,
            )}
            labelColor={c().tile.info.annotationColor}
            renderLabel={renderRowLabel}
            recency={recency()}
            title={title()}
            hiddenByFilter={props.entry.hiddenByFilter}
            onSelect={() => props.onSelect(props.entry.blocked.id)}
            testId="dock-needs-you-entry"
          />
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
    <DockNeedsYouStrip density={props.density} testId="dock-needs-you-strip">
      <For each={props.entries}>
        {(entry) => (
          <NeedsYouEntryRow
            entry={entry}
            density={props.density}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </DockNeedsYouStrip>
  </Show>
);
