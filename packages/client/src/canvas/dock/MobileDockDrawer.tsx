/** MobileDockDrawer — left-edge swipe drawer carrying the dock
 *  terminal list on mobile.
 *
 *  Mobile mirror of the desktop dock (#903): the dock is the canonical
 *  live-terminal navigator, so on mobile it gets the standard iOS /
 *  Android "navigation drawer" gesture — swipe from the left edge, or
 *  tap the thin left-edge handle, to reveal the terminal list.
 *
 *  Scope kept tight on purpose: rows are simple (`dot · branch · time`,
 *  with a foreground line on non-agent rows). No reply input and no
 *  xterm buffer tail — the user's intent here is "switch to that other
 *  terminal", not "respond inline".
 *
 *  Row order mirrors the desktop dock: same `useDockOrder` singleton,
 *  so the mobile drawer and desktop never disagree on group order, row
 *  order, or which rows are hidden by the activity window. */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, For, Show, createMemo } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import { formatTimeAgo } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import {
  activityWindow,
  setActivityWindow,
  windowOption,
} from "../../terminal/activityWindow";
import type { DockRowBucket } from "./dockRowRanking";
import type { DockGroup } from "./dockTree";
import { useDockOrder } from "./useDockOrder";
import { RowIcons } from "./RowIcons";

const MobileDockDrawer: Component<{
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  const tree = useDockOrder();

  function handleSelect(id: TerminalId) {
    props.onSelect(id);
    props.onClose();
  }

  return (
    <div data-testid="mobile-dock-sheet" class="flex flex-col h-full">
      <div class="px-3 py-2 border-b border-edge/50 shrink-0">
        <span class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-3">
          Terminals
        </span>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <For each={tree().groups}>
          {(group) => <MobileSection group={group} onSelect={handleSelect} />}
        </For>
      </div>
      <Show when={tree().parkedCount > 0 && activityWindow() !== "all"}>
        <button
          type="button"
          data-testid="mobile-dock-hidden-footer"
          onClick={() => setActivityWindow("all")}
          class="flex items-center gap-2 px-3 py-3 border-t border-edge/40 text-[0.75rem] text-fg-3 active:bg-surface-2 text-left cursor-pointer"
        >
          <span class="tabular-nums">{tree().parkedCount}</span>
          <span>
            hidden by{" "}
            <span class="font-mono">
              {windowOption(activityWindow()).short}
            </span>{" "}
            window
          </span>
          <span class="ml-auto text-accent shrink-0">show all</span>
        </button>
      </Show>
    </div>
  );
};

/** Repo section — header (uppercase name + colored swatch + row count)
 *  over the group's rows. Always rendered, matching the desktop dock's
 *  "section headers always on" policy. */
const MobileSection: Component<{
  group: DockGroup;
  onSelect: (id: TerminalId) => void;
}> = (props) => (
  // Subgrid container — same shape as the desktop dock. Empty pip
  // columns collapse to 0 width so the branch label gets every
  // pixel that isn't being used by a live pip.
  <section
    data-testid="mobile-dock-section"
    data-repo={props.group.name}
    class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] gap-x-3 px-3"
  >
    <div class="col-span-full flex items-center gap-2 pt-3 pb-1">
      <span
        aria-hidden="true"
        class="w-2.5 h-2.5 rounded-sm shrink-0"
        style={{ "background-color": props.group.color }}
      />
      <span class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] text-fg-2 truncate min-w-0">
        {props.group.name}
      </span>
      <span class="ml-auto font-mono text-[0.65rem] tabular-nums text-fg-3 shrink-0">
        {props.group.rows.length}
      </span>
    </div>
    <For each={props.group.rows}>
      {(row) => (
        <MobileRow id={row.id} bucket={row.bucket} onSelect={props.onSelect} />
      )}
    </For>
  </section>
);

const MobileRow: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const combined = createMemo(() => {
    const info = store.getDisplayInfo(props.id);
    const meta = store.getMetadata(props.id);
    if (!info || !meta) return null;
    return { info, meta };
  });
  const active = () => store.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  const live = () => props.bucket === "awaiting" || props.bucket === "working";
  const foreground = (m: TerminalMetadata) =>
    m.foreground?.title ?? m.foreground?.name ?? null;
  return (
    <Show when={combined()}>
      {(c) => (
        <button
          type="button"
          data-testid="mobile-dock-row"
          data-terminal-id={props.id}
          data-bucket={props.bucket}
          data-active={active() ? "" : undefined}
          data-unread={unread() ? "" : undefined}
          data-sub-count={c().info.subCount > 0 ? c().info.subCount : undefined}
          // stopPropagation on pointerdown keeps Corvu Drawer's
          // drag-to-dismiss from claiming the tap.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.onSelect(props.id)}
          class="relative w-full grid grid-cols-subgrid col-span-full items-center text-left transition-colors duration-150 cursor-pointer active:bg-surface-2 border-b border-edge/15 data-[active]:bg-surface-2 data-[active]:shadow-[inset_3px_0_0_var(--color-accent)]"
          classList={{
            "py-3": live(),
            "py-2": !live(),
          }}
        >
          <span
            class="font-medium leading-tight truncate min-w-0"
            classList={{
              "text-[0.95rem]": live(),
              "text-[0.85rem]": !live(),
            }}
            style={{
              color: c().info.annotationColor,
            }}
          >
            <IntentMarkdownInline
              markdown={annotationLine(c().meta.intent, c().info.key.label)}
            />
          </span>
          <RowIcons meta={c().meta} info={c().info} />
          <span class="font-mono text-[0.65rem] tabular-nums text-fg-3 text-right">
            {formatTimeAgo(c().meta.lastActivityAt)}
          </span>
          <Show when={unread()}>
            <span
              aria-hidden="true"
              class="absolute top-1 right-1 w-2 h-2 rounded-full bg-alert"
            />
          </Show>
          <Show when={!c().meta.agent && foreground(c().meta)}>
            {(fg) => (
              <span
                data-testid="mobile-dock-foreground"
                class="col-start-1 col-end-[-1] font-mono text-[0.7rem] text-fg-2 truncate min-w-0"
              >
                {fg()}
              </span>
            )}
          </Show>
        </button>
      )}
    </Show>
  );
};

export default MobileDockDrawer;
