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
import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { formatTimeAgo } from "../../terminal/staleness";
import { useStatePip } from "../../terminal/statePipBind";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import { createDockRowData } from "./dockRowData";
import { type RankedDockRow, rowRecencyAt } from "./dockRowRanking";
import RecencyCell, { displayRecencyAt, recencyMode } from "./RecencyCell";

/** One mirrored entry. Reads the same pip binding and the same recency cell the
 *  structural row does, so the two renderings of one terminal cannot drift —
 *  the whole point of a mirror is that it agrees with what it mirrors. */
const NeedsYouEntry: Component<{
  row: RankedDockRow;
  rail: boolean;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const combined = createDockRowData(props.row.id);
  const unread = () => store.isUnread(props.row.id);
  return (
    <Show when={combined()}>
      {(c) => {
        const pip = useStatePip(
          encActiveHost,
          () => props.row.id,
          () => c().meta,
          unread,
          () => props.row.pip,
        );
        const mode = () => recencyMode(pip());
        const waitAt = () =>
          displayRecencyAt(mode(), props.row.ts, rowRecencyAt(c().meta));
        // Same clock the capsule shows, in words, for the rail's tooltip.
        const waitLabel = () => formatTimeAgo(waitAt()) || "a moment";
        return (
          <button
            type="button"
            data-testid="dock-needs-you-entry"
            onClick={() => props.onSelect(props.row.id)}
            // The rail is 44px, so it drops the label and the wait capsule and
            // shows the pip alone. The duration is the reason to glance at this
            // strip at all, so the rail carries it in the tooltip rather than
            // losing it — an unlabelled band of pips is not the feature.
            title={`${c().info.key.group} · ${c().info.key.label} — waiting on you${
              props.rail ? ` for ${waitLabel()}` : ""
            }`}
            class={`flex items-center gap-1.5 w-full rounded-md cursor-pointer text-left transition-colors duration-150 hover:bg-surface-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
              props.rail ? "justify-center py-1" : "px-1.5 py-1"
            }`}
          >
            <StatePip {...pip()} class={DOCK_ROW_PIP_BOX} />
            <Show when={!props.rail}>
              <span
                class="flex-1 min-w-0 truncate text-[0.8rem]"
                style={{ color: c().info.annotationColor }}
              >
                <IntentMarkdownInline
                  markdown={annotationLine(c().meta.intent, c().info.key.label)}
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
  rows: readonly RankedDockRow[];
  rail: boolean;
  onSelect: (id: TerminalId) => void;
}> = (props) => (
  <Show when={props.rows.length > 0}>
    <section
      data-testid="dock-needs-you-strip"
      aria-label="Agents waiting on you"
      class="shrink-0 flex flex-col gap-0.5 border-b border-edge/40 py-1"
      classList={{ "px-1": !props.rail }}
    >
      <Show when={!props.rail}>
        <span class="px-1.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.12em] text-fg-3">
          Needs you
        </span>
      </Show>
      <For each={props.rows}>
        {(row) => (
          <NeedsYouEntry
            row={row}
            rail={props.rail}
            onSelect={props.onSelect}
          />
        )}
      </For>
    </section>
  </Show>
);
