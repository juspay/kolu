/** MobileDockDrawer — left-edge swipe drawer carrying the activity-dock
 *  terminal list on mobile.
 *
 *  Mobile mirror of the desktop activity dock (#903): the dock is the
 *  canonical live-terminal navigator, so on mobile it gets the standard
 *  iOS/Android "navigation drawer" gesture — swipe from the left edge,
 *  or tap the thin left-edge handle, to reveal the terminal list.
 *
 *  Scope kept tight on purpose: rows are simple (one-liner per
 *  terminal with repo color, branch label, agent state, unread dot),
 *  no reply input and no xterm buffer tail. The desktop dock's
 *  cards level is overkill on a phone — the user's intent here is
 *  "switch to that other terminal", not "respond inline".
 *
 *  Sort order matches the desktop dock: recency-descending across all
 *  terminals (parked terminals fall to the bottom, faded). That keeps
 *  "what just changed?" as the first row regardless of which repo it
 *  belongs to. */

import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show, createMemo } from "solid-js";
import AgentIndicator from "./terminal/AgentIndicator";
import { formatTimeAgo, useStaleCheck } from "./terminal/staleness";
import { useTerminalStore } from "./terminal/useTerminalStore";
import { agentBucket } from "./canvas/workspace-switcher";

type MobileDockBucket = "awaiting" | "working" | "idle" | "parked" | "none";

const BUCKET_PRIORITY: Record<MobileDockBucket, number> = {
  awaiting: 0,
  working: 1,
  idle: 2,
  parked: 3,
  none: 4,
};

const MobileDockDrawer: Component<{
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();

  const ranked = createMemo(() => {
    const rows: {
      id: TerminalId;
      bucket: MobileDockBucket;
      ts: number;
    }[] = [];
    for (const id of store.terminalIds()) {
      const meta = store.getMetadata(id);
      if (!meta) continue;
      const parked = isStale(meta.lastActivityAt);
      const agent = agentBucket(meta.agent);
      let bucket: MobileDockBucket;
      if (parked) bucket = "parked";
      else if (agent === "none") bucket = "none";
      else if (agent === "awaiting") bucket = "awaiting";
      else bucket = "working";
      if (bucket === "none" && meta.lastActivityAt > 0) bucket = "idle";
      rows.push({ id, bucket, ts: meta.lastActivityAt });
    }
    rows.sort((a, b) => {
      if (a.ts !== b.ts) return b.ts - a.ts;
      return BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket];
    });
    return rows;
  });

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
        <For each={ranked()}>
          {(row) => (
            <Row id={row.id} bucket={row.bucket} onSelect={handleSelect} />
          )}
        </For>
      </div>
    </div>
  );
};

const Row: Component<{
  id: TerminalId;
  bucket: MobileDockBucket;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const info = () => store.getDisplayInfo(props.id);
  const meta = () => store.getMetadata(props.id);
  const active = () => store.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  return (
    <Show when={info() && meta()}>
      <button
        type="button"
        data-testid="mobile-dock-row"
        data-terminal-id={props.id}
        data-bucket={props.bucket}
        data-active={active() ? "" : undefined}
        data-unread={unread() ? "" : undefined}
        // stopPropagation on pointerdown keeps Corvu Drawer's
        // drag-to-dismiss from claiming the tap.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onSelect(props.id)}
        class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer active:bg-surface-2 border-b border-edge/15"
        classList={{
          "bg-accent/15": active(),
          "opacity-60": props.bucket === "parked" && !active(),
        }}
      >
        <span
          aria-hidden="true"
          class="w-1 h-8 rounded-full shrink-0"
          style={{ "background-color": info()?.repoColor }}
        />
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <div class="flex items-baseline justify-between gap-2 min-w-0">
            <span
              class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
              style={{ color: info()?.repoColor }}
            >
              {info()?.key.group}
            </span>
            <span
              class="text-[0.85rem] font-medium leading-tight truncate min-w-0"
              style={{ color: info()?.branchColor }}
            >
              {info()?.key.label}
            </span>
          </div>
          <Show when={meta()?.agent}>
            {(agent) => (
              <div class="flex items-center justify-between gap-2 min-w-0 text-[0.6rem] text-fg-3">
                <AgentIndicator agent={agent()} />
                <Show when={formatTimeAgo(meta()?.lastActivityAt ?? 0)}>
                  {(label) => (
                    <span class="tabular-nums shrink-0">{label()}</span>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>
        <Show when={unread()}>
          <span class="w-2 h-2 rounded-full bg-alert shrink-0" />
        </Show>
      </button>
    </Show>
  );
};

export default MobileDockDrawer;
