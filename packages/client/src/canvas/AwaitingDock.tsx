/** Awaiting dock — top-left column surfacing every active agent.
 *  **One list, sorted strictly by `lastActivityAt` descending** so the
 *  most recent transition is always at the top regardless of which
 *  state it lands in. The dock answers "what just changed?" first,
 *  "what's blocking me?" second.
 *
 *  Two view modes, switched by the chevron at the top (or by clicking
 *  it — `dockCollapsed` persists per-device in localStorage):
 *
 *  1. **Expanded** (default) — full cards / compact pills:
 *     - *Awaiting cards*: tail of xterm buffer (via `tailBuffer`) +
 *       reply input wired straight to the PTY. The repo+branch+tail
 *       region is the click target that activates the underlying
 *       terminal; the input form is a sibling so focusing it doesn't
 *       switch tiles away.
 *     - *Working pills*: repo + branch + animated agent indicator,
 *       click to jump.
 *  2. **Collapsed** — narrow strip of per-agent dots. Each dot is
 *     `repoColor`-filled with a `pill-border-{awaiting,working}` ring
 *     so the state-cadence (breathe / pulse) survives the collapse.
 *     Hover → tooltip with repo/branch/state/time; click → jump.
 *     Trades full context for a 20px-wide footprint so 13" screens
 *     reclaim the left rail.
 *
 *  Parked (auto-stale, `lastActivityAt > STALE_THRESHOLD_MS`)
 *  terminals are filtered out entirely.
 *
 *  Anchored top-left (below the ChromeBar) so the right edge stays
 *  free for the inspector panel and the bottom-left minimap gets a
 *  reserved zone via `max-h`. Auto-hides when no agents are active. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import {
  type Component,
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import AgentIndicator from "../terminal/AgentIndicator";
import { tailBuffer } from "../terminal/bufferTail";
import { formatTimeAgo, useStaleCheck } from "../terminal/staleness";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { stateLabels } from "../ui/agentDisplay";
import { client } from "../wire";
import { useTileTheme } from "./useTileTheme";
import { agentBucket } from "./workspace-switcher/model";

const PEEK_REFRESH_MS = 250;
const MIN_TAIL_LINES = 2;
const MAX_TAIL_LINES = 7;
/** Per-card tail budget shrinks as the dock fills.
 *
 *  Each card has ~120px of fixed chrome (eyebrow + agent row + reply
 *  input + padding); tail lines add ~18px each. Subtract a top-offset
 *  + bottom-margin reserve (~200px), divide the remaining height
 *  across the visible cards, then floor to a line count. So a single
 *  card on a tall viewport gets ~10 lines; ten cards on the same
 *  viewport collapse to the 2-line floor. Working pills don't show
 *  a tail, but they still occupy ~40px of vertical space, so they
 *  count against the budget too. */
function tailLinesFor(viewportPx: number, numCards: number): number {
  if (numCards === 0) return MIN_TAIL_LINES;
  const reserved = 200;
  const cardBase = 120;
  const tailLineHeight = 18;
  const available = Math.max(0, viewportPx - reserved - cardBase * numCards);
  const perCardTailPx = available / numCards;
  return Math.max(
    MIN_TAIL_LINES,
    Math.min(MAX_TAIL_LINES, Math.floor(perCardTailPx / tailLineHeight)),
  );
}

const [viewportHeight, setViewportHeight] = createSignal(
  typeof window === "undefined" ? 1000 : window.innerHeight,
);

/** Collapsed = narrow strip of per-agent dots; expanded = full
 *  cards/pills. Per-device localStorage so a user's choice survives
 *  reloads but doesn't sync across machines (a 13" laptop might want
 *  collapsed while a 27" desktop stays expanded). */
const [dockCollapsed, setDockCollapsed] = makePersisted(createSignal(false), {
  name: "kolu-awaiting-dock-collapsed",
  serialize: (v) => (v ? "1" : "0"),
  deserialize: (raw) => raw === "1",
});

const AwaitingDock: Component = () => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  onMount(() => {
    setViewportHeight(window.innerHeight);
    makeEventListener(window, "resize", () =>
      setViewportHeight(window.innerHeight),
    );
  });
  const liveIds = createMemo(() =>
    store
      .terminalIds()
      .filter((id) => {
        const meta = store.getMetadata(id);
        if (!meta) return false;
        if (isStale(meta.lastActivityAt)) return false;
        const bucket = agentBucket(meta.agent);
        return bucket === "awaiting" || bucket === "working";
      })
      .sort((a, b) => {
        const ta = store.getMetadata(a)?.lastActivityAt ?? 0;
        const tb = store.getMetadata(b)?.lastActivityAt ?? 0;
        return tb - ta;
      }),
  );
  const tailLines = createMemo(() =>
    tailLinesFor(viewportHeight(), liveIds().length),
  );

  return (
    <Show when={liveIds().length > 0}>
      <div
        data-testid="awaiting-dock"
        data-collapsed={dockCollapsed() ? "" : undefined}
        class="absolute top-20 left-4 z-20 flex flex-col gap-1.5 items-start overflow-y-auto overflow-x-hidden scrollbar-none p-1 max-h-[calc(100vh-22rem)]"
      >
        <ChevronToggle />
        <Show
          when={!dockCollapsed()}
          fallback={<For each={liveIds()}>{(id) => <DockDot id={id} />}</For>}
        >
          <For each={liveIds()}>
            {(id) => <DockItem id={id} tailLines={tailLines()} />}
          </For>
        </Show>
      </div>
    </Show>
  );
};

/** Tiny chevron toggle between collapsed and expanded modes. Sits at
 *  the top of the dock; same anchor in both modes so the user's eye
 *  doesn't have to chase it across the canvas. */
const ChevronToggle: Component = () => {
  return (
    <button
      type="button"
      data-testid="awaiting-dock-toggle"
      onClick={() => setDockCollapsed((v) => !v)}
      class="w-6 h-6 flex items-center justify-center rounded-md bg-surface-1/85 border border-edge/60 backdrop-blur-sm text-fg-1 hover:bg-surface-2/90 hover:border-edge-bright/70 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 text-[0.85rem] leading-none shadow-sm"
      title={
        dockCollapsed() ? "Expand awaiting dock" : "Collapse awaiting dock"
      }
      aria-label={
        dockCollapsed() ? "Expand awaiting dock" : "Collapse awaiting dock"
      }
    >
      {dockCollapsed() ? "▸" : "◂"}
    </button>
  );
};

/** Collapsed-mode dot: one per active agent. Filled with `repoColor`,
 *  ringed by the same animated `pill-border-{awaiting,working}` channel
 *  as the expanded cards so the state-cadence carries over. Click → jump
 *  to that terminal; hover → tooltip with repo / branch / state / time. */
const DockDot: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const combined = createMemo(() => {
    const i = store.getDisplayInfo(props.id);
    const m = store.getMetadata(props.id);
    return i && m ? { info: i, meta: m } : null;
  });
  return (
    <Show when={combined()}>
      {(c) => {
        const displayInfo = c().info;
        const m = c().meta;
        const bucket = agentBucket(m.agent);
        const stateText = m.agent ? stateLabels[m.agent.state] : "";
        const tooltip = `${displayInfo.key.group} / ${displayInfo.key.label} · ${stateText} · ${formatTimeAgo(m.lastActivityAt)}`;
        return (
          <button
            type="button"
            data-testid="awaiting-dock-dot"
            data-terminal-id={props.id}
            data-agent-bucket={bucket}
            onClick={() => store.activate(props.id)}
            class={`pill-border ${bucket === "awaiting" ? "pill-border-awaiting" : "pill-border-working"} w-3.5 h-3.5 rounded-full cursor-pointer hover:scale-110 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}
            style={{
              "background-color": displayInfo.repoColor,
              "--pill-border-radius": "9999px",
              "--pill-state-color":
                bucket === "awaiting"
                  ? "var(--color-alert)"
                  : "var(--color-accent)",
            }}
            title={tooltip}
            aria-label={tooltip}
          />
        );
      }}
    </Show>
  );
};

/** Picks the right shape for a terminal based on its current bucket.
 *  Reactive so a thinking → waiting transition swaps the pill for the
 *  full card in place. */
const DockItem: Component<{ id: TerminalId; tailLines: number }> = (props) => {
  const store = useTerminalStore();
  const bucket = createMemo(() =>
    agentBucket(store.getMetadata(props.id)?.agent),
  );
  return (
    <Show
      when={bucket() === "awaiting"}
      fallback={<WorkingPill id={props.id} />}
    >
      <AwaitingCard id={props.id} tailLines={props.tailLines} />
    </Show>
  );
};

const AwaitingCard: Component<{ id: TerminalId; tailLines: number }> = (
  props,
) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const combined = createMemo(() => {
    const i = store.getDisplayInfo(props.id);
    const m = store.getMetadata(props.id);
    return i && m ? { info: i, meta: m } : null;
  });
  const [tail, setTail] = createSignal<string[]>([]);
  const [value, setValue] = createSignal("");

  const refresh = () => {
    const xterm = getTerminalRefs(props.id)?.xterm;
    if (!xterm) {
      setTail([]);
      return;
    }
    setTail(tailBuffer(xterm, props.tailLines));
  };

  refresh();
  const interval = setInterval(refresh, PEEK_REFRESH_MS);
  onCleanup(() => clearInterval(interval));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const text = value().trim();
    if (text.length === 0) return;
    setValue("");
    // TUI agents (e.g. Codex Ratatui) drop text+CR when delivered in a
    // single PTY write; split the carriage return into a second write so
    // the input parser sees it as a discrete event.
    await client.terminal.sendInput({ id: props.id, data: text });
    setTimeout(() => {
      void client.terminal.sendInput({ id: props.id, data: "\r" });
    }, 50);
  }

  return (
    <Show when={combined()}>
      {(c) => {
        const displayInfo = c().info;
        const m = c().meta;
        return (
          <div
            data-testid="awaiting-dock-card"
            data-terminal-id={props.id}
            class="pill-border pill-border-awaiting rounded-lg p-2.5 w-[280px] flex flex-col gap-1.5 shadow-lg"
            style={{
              "--pill-border-radius": "calc(0.5rem + 2px)",
              "background-color": tileTheme(props.id).bg,
              color: tileTheme(props.id).fg,
              border: `1px solid ${displayInfo.repoColor}`,
            }}
          >
            <button
              type="button"
              onClick={() => store.activate(props.id)}
              class="flex flex-col gap-1 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
              title="Jump to this terminal"
            >
              <div class="flex items-baseline justify-between gap-2 min-w-0">
                <span
                  class="font-mono text-[0.7rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
                  style={{ color: displayInfo.repoColor }}
                >
                  {displayInfo.key.group}
                </span>
                <span
                  class="text-[0.95rem] font-semibold leading-tight truncate min-w-0"
                  style={{ color: displayInfo.branchColor }}
                >
                  {displayInfo.key.label}
                </span>
              </div>
              <DockMetaRow meta={m} />
              <PrLine meta={m} />
              <Show when={tail().length > 0}>
                <div
                  data-testid="awaiting-dock-tail"
                  class="font-mono text-[0.7rem] text-fg-2 leading-snug whitespace-pre-wrap break-all w-full mt-0.5"
                >
                  <For each={tail()}>
                    {(line) => <div class="truncate">{line}</div>}
                  </For>
                </div>
              </Show>
            </button>
            <form onSubmit={submit}>
              <input
                type="text"
                data-testid="awaiting-dock-reply"
                value={value()}
                onInput={(e) => setValue(e.currentTarget.value)}
                placeholder="Reply…"
                class="w-full rounded px-2 py-1 text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-accent/40 placeholder:opacity-60"
                style={{
                  color: "inherit",
                  "background-color":
                    "color-mix(in oklch, currentColor 8%, transparent)",
                  border:
                    "1px solid color-mix(in oklch, currentColor 25%, transparent)",
                }}
                autocomplete="off"
                autocorrect="off"
                spellcheck={false}
              />
            </form>
          </div>
        );
      }}
    </Show>
  );
};

const WorkingPill: Component<{ id: TerminalId }> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const combined = createMemo(() => {
    const i = store.getDisplayInfo(props.id);
    const m = store.getMetadata(props.id);
    return i && m ? { info: i, meta: m } : null;
  });

  return (
    <Show when={combined()}>
      {(c) => {
        const displayInfo = c().info;
        const m = c().meta;
        return (
          <button
            type="button"
            data-testid="awaiting-dock-working"
            data-terminal-id={props.id}
            onClick={() => store.activate(props.id)}
            class="pill-border pill-border-working rounded-lg px-2.5 py-1 flex flex-col gap-0.5 w-[280px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 text-left"
            style={{
              "--pill-border-radius": "calc(0.5rem + 2px)",
              "background-color": tileTheme(props.id).bg,
              color: tileTheme(props.id).fg,
              border: `1px solid ${displayInfo.repoColor}`,
            }}
            title="Jump to this terminal"
          >
            <div class="flex items-baseline justify-between gap-2 min-w-0">
              <span
                class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
                style={{ color: displayInfo.repoColor }}
              >
                {displayInfo.key.group}
              </span>
              <span
                class="text-[0.85rem] font-semibold leading-tight truncate min-w-0"
                style={{ color: displayInfo.branchColor }}
              >
                {displayInfo.key.label}
              </span>
            </div>
            <DockMetaRow meta={m} />
            <PrLine meta={m} />
          </button>
        );
      }}
    </Show>
  );
};

/** GitHub PR summary line (when one is resolved). Reads `meta.pr` —
 *  the same source the workspace switcher uses — so the kinds it
 *  accepts stay aligned: only `kind === "ok"` renders, the
 *  `absent`/`pending`/`unavailable` cases collapse to nothing. */
const PrLine: Component<{ meta: TerminalMetadata }> = (props) => {
  const pr = () => (props.meta.pr.kind === "ok" ? props.meta.pr.value : null);
  return (
    <Show when={pr()}>
      {(p) => (
        <div class="flex items-baseline gap-1.5 min-w-0 text-[0.65rem] text-fg-2">
          <span class="font-mono tabular-nums text-fg-3 shrink-0">
            #{p().number}
          </span>
          <span class="truncate min-w-0">{p().title}</span>
        </div>
      )}
    </Show>
  );
};

/** Shared "agent indicator (left) + lastActive (right)" sub-line used
 *  on both the full card and the compact pill. Renders nothing when
 *  the terminal has no agent — `<AwaitingDock>` only mounts these
 *  components when `agentBucket` is awaiting/working, but the
 *  `Show` keeps the render shape honest. */
const DockMetaRow: Component<{ meta: TerminalMetadata }> = (props) => {
  const lastActive = () => formatTimeAgo(props.meta.lastActivityAt);
  return (
    <Show when={props.meta.agent}>
      {(agent) => (
        <div class="flex items-center justify-between gap-2 min-w-0 text-[0.6rem] text-fg-3">
          <AgentIndicator agent={agent()} />
          <Show when={lastActive()}>
            {(label) => <span class="tabular-nums shrink-0">{label()}</span>}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default AwaitingDock;
