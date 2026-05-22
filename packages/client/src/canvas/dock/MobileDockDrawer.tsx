/** MobileDockDrawer — left-edge swipe drawer carrying the dock
 *  terminal list on mobile.
 *
 *  Mobile mirror of the desktop dock (#903): the dock is the
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

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, For, Show, createMemo } from "solid-js";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import AgentIndicator from "../../terminal/AgentIndicator";
import { formatTimeAgo, useStaleCheck } from "../../terminal/staleness";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { resolvedPr } from "../dockModel";
import { type DockRowBucket, rankDockRows } from "./dockRowRanking";

const MobileDockDrawer: Component<{
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();

  const ranked = createMemo(() =>
    rankDockRows(store.terminalIds(), store.getMetadata, isStale),
  );

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

/** Live-attention buckets (awaiting/working) get a richer row — taller
 *  padding, bigger headline type, an agent/time meta line, and a PR
 *  line when one is resolved. Idle/parked/none stay as compact
 *  one-liners — they're the "navigate to it later" bucket, not the
 *  "needs you now" bucket, so they don't earn the extra height.
 *
 *  Mirrors the desktop dock's awaiting-card / working-pill / quiet-row
 *  hierarchy; the cap is `lastActivityAt > 4h ago` (i.e. parked)
 *  routing the row to the quiet variant regardless of prior agent
 *  state, same as `useStaleCheck` enforces in the ranking step. */
function isLive(bucket: DockRowBucket): boolean {
  return bucket === "awaiting" || bucket === "working";
}

const Row: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  onSelect: (id: TerminalId) => void;
}> = (props) => {
  const store = useTerminalStore();
  const info = () => store.getDisplayInfo(props.id);
  const meta = () => store.getMetadata(props.id);
  const active = () => store.activeId() === props.id;
  const unread = () => store.isUnread(props.id);
  const live = () => isLive(props.bucket);
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
        class="w-full flex items-stretch gap-3 px-3 text-left transition-[margin,border-radius,box-shadow,background-color,color] duration-300 ease-out cursor-pointer active:bg-surface-2 border-b border-edge/15 data-[active]:m-1.5 data-[active]:rounded-lg data-[active]:border-b-transparent data-[active]:bg-accent data-[active]:text-white data-[active]:shadow-[var(--dock-active-halo)] data-[active]:animate-[dock-row-activate_0.36s_cubic-bezier(0.34,1.45,0.6,1),dock-row-flash_0.48s_ease-out]"
        classList={{
          "py-3": live(),
          "py-2": !live(),
          // Parked dim for inactive rows only. Active treatment
          // (lifted card + accent flood + pop-in animation) lives
          // in the class string above as `data-[active]:*` variants.
          "opacity-60": props.bucket === "parked" && !active(),
        }}
      >
        <span
          aria-hidden="true"
          class="w-1 rounded-full shrink-0 self-stretch"
          style={{ "background-color": info()?.repoColor }}
        />
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <div class="flex items-baseline justify-between gap-2 min-w-0">
            <span
              class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
              // Inherit when active so the row's white color flows
              // through; otherwise paint the per-repo identity color.
              style={{
                color: active() ? "inherit" : info()?.repoColor,
              }}
            >
              {info()?.key.group}
            </span>
            <span
              class="font-medium leading-tight truncate min-w-0"
              classList={{
                "text-[0.95rem]": live(),
                "text-[0.8rem]": !live(),
              }}
              style={{
                color: active() ? "inherit" : info()?.annotationColor,
              }}
            >
              <IntentMarkdownInline
                markdown={annotationLine(
                  meta()?.intent,
                  info()?.key.label ?? "",
                )}
              />
            </span>
          </div>
          <Show when={live() && meta()?.agent}>
            {(agent) => (
              <div class="flex items-center justify-between gap-2 min-w-0 text-[0.65rem] text-fg-3">
                <AgentIndicator agent={agent()} />
                <Show when={formatTimeAgo(meta()?.lastActivityAt ?? 0)}>
                  {(label) => (
                    <span class="tabular-nums shrink-0">{label()}</span>
                  )}
                </Show>
              </div>
            )}
          </Show>
          <Show when={live()}>
            <PrLine meta={meta()} />
          </Show>
          {/* Foreground process line — surfaced on quiet (non-live)
           *  rows so plain shells aren't reduced to bare repo + branch
           *  when they're running something like `pu connect srid1`
           *  or `nix build`. The live rows have agent state +
           *  optional PR carrying the same "what is this terminal
           *  doing?" signal, so a foreground row there would be
           *  redundant. */}
          <Show when={!live()}>
            <ForegroundLine meta={meta()} />
          </Show>
        </div>
        <Show when={unread()}>
          <span class="w-2 h-2 mt-1 rounded-full bg-alert shrink-0" />
        </Show>
      </button>
    </Show>
  );
};

/** Foreground process line — e.g. `pu connect srid1`, `nix build`.
 *  Pulled from `meta.foreground.title` (full command line) with
 *  `.name` (executable) as fallback. Returns null when nothing is
 *  running so the row stays compact. */
const ForegroundLine: Component<{ meta: TerminalMetadata | undefined }> = (
  props,
) => {
  const fg = () => {
    const m = props.meta;
    if (!m) return null;
    return m.foreground?.title ?? m.foreground?.name ?? null;
  };
  return (
    <Show when={fg()}>
      {(label) => (
        <span
          data-testid="mobile-dock-foreground"
          class="font-mono text-[0.7rem] text-fg-2 truncate min-w-0"
        >
          {label()}
        </span>
      )}
    </Show>
  );
};

/** PR summary line — `#N title` — rendered when the terminal's PR is
 *  in the resolved `ok` state. Mirrors the desktop dock's `PrLine` so
 *  the awaiting/working rows on mobile carry the same identity rung
 *  the desktop cards do. Returns null for `absent` / `pending` /
 *  `unavailable` PR kinds so the row collapses cleanly. */
const PrLine: Component<{ meta: TerminalMetadata | undefined }> = (props) => {
  const pr = () => {
    const m = props.meta;
    if (!m) return null;
    return resolvedPr(m.pr);
  };
  return (
    <Show when={pr()}>
      {(p) => (
        <div class="flex items-baseline gap-1.5 min-w-0 text-[0.7rem] text-fg-2">
          <span class="font-mono tabular-nums text-fg-3 shrink-0">
            #{p().number}
          </span>
          <span class="truncate min-w-0">{p().title}</span>
        </div>
      )}
    </Show>
  );
};

export default MobileDockDrawer;
