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
import { SplitToggleIcon } from "../../ui/Icons";
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
        data-sub-count={
          (info()?.subCount ?? 0) > 0 ? info()?.subCount : undefined
        }
        // stopPropagation on pointerdown keeps Corvu Drawer's
        // drag-to-dismiss from claiming the tap.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onSelect(props.id)}
        class="w-full flex items-stretch gap-3 px-3 text-left transition-[margin,border-radius,box-shadow,background-color,color] duration-300 ease-out cursor-pointer active:bg-surface-2 border-b border-edge/15 data-[active]:m-1.5 data-[active]:rounded-lg data-[active]:border-b-transparent data-[active]:bg-accent data-[active]:text-white data-[active]:[&_.text-fg-2]:text-white/85 data-[active]:[&_.text-fg-3]:text-white/70 data-[active]:shadow-[var(--dock-active-halo)] data-[active]:animate-[dock-row-activate_0.36s_cubic-bezier(0.34,1.45,0.6,1),dock-row-flash_0.48s_ease-out] motion-reduce:transition-none motion-reduce:data-[active]:animate-none"
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
              // Drop inline color when active so the row's white cascades
              // through; otherwise paint the per-repo identity color.
              style={{
                color: active() ? undefined : info()?.repoColor,
              }}
            >
              {info()?.key.group}
            </span>
            <div class="flex items-baseline gap-2 min-w-0">
              <span
                class="font-medium leading-tight truncate min-w-0"
                classList={{
                  "text-[0.95rem]": live(),
                  "text-[0.8rem]": !live(),
                }}
                style={{
                  color: active() ? undefined : info()?.annotationColor,
                }}
              >
                <IntentMarkdownInline
                  markdown={annotationLine(
                    meta()?.intent,
                    info()?.key.label ?? "",
                  )}
                />
              </span>
              <Show when={(info()?.subCount ?? 0) > 0}>
                <MobileSubCountChip
                  count={info()?.subCount ?? 0}
                  active={active()}
                />
              </Show>
            </div>
          </div>
          {/* AgentIndicator surfaces on every row that carries a known
           *  agent — live (awaiting/working) AND parked. Without this
           *  fallback on quiet rows, a 20h-stale waiting agent renders
           *  as a plain shell after the laptop sleeps past the activity
           *  window. The full reply card / tail preview stays
           *  live-only; the quiet row only carries identity. */}
          <Show when={meta()?.agent}>
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
           *  or `nix build`. Live rows have the PR line and the
           *  agent indicator already; foreground duplicates that. */}
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

/** Mirrors the desktop dock's `SubCountChip` (Dock.tsx): surfaces the
 *  open-sub-terminal count on the mobile row's title bar with the same
 *  `SplitToggleIcon`+count vocabulary so the symbol reads consistently
 *  across surfaces. Active rows get a translucent-white treatment to
 *  survive the accent flood. */
const MobileSubCountChip: Component<{ count: number; active: boolean }> = (
  props,
) => {
  const label = () =>
    `${props.count} sub-terminal${props.count === 1 ? "" : "s"}`;
  return (
    <span
      data-testid="mobile-dock-sub-count"
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[0.7rem] font-semibold tabular-nums leading-none shrink-0"
      style={{
        "background-color": props.active
          ? "rgba(255, 255, 255, 0.18)"
          : "color-mix(in oklch, currentColor 10%, transparent)",
        border: props.active
          ? "1px solid rgba(255, 255, 255, 0.32)"
          : "1px solid color-mix(in oklch, currentColor 22%, transparent)",
      }}
      title={label()}
    >
      <SplitToggleIcon class="w-3 h-3" />
      <span>{props.count}</span>
    </span>
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
