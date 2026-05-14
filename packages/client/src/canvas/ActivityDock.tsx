/** Activity dock — top-left column surfacing every active agent.
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

import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
} from "solid-js";
import AgentIndicator from "../terminal/AgentIndicator";
import { tailBuffer } from "../terminal/bufferTail";
import { formatTimeAgo, useStaleCheck } from "../terminal/staleness";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { client } from "../wire";
import { useTileTheme } from "./useTileTheme";
import { agentBucket } from "./workspace-switcher";

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

// Module-scope viewport height + resize listener. Lifecycle matches the
// signal itself (browser session) rather than `ActivityDock`'s mount —
// otherwise a resize while the dock is auto-hidden (no live agents)
// would leave `viewportHeight` stale, and the next mount on a different
// screen size would compute `tailLinesFor` against pre-resize height.
const [viewportHeight, setViewportHeight] = createSignal(
  typeof window === "undefined" ? 1000 : window.innerHeight,
);
if (typeof window !== "undefined") {
  window.addEventListener("resize", () =>
    setViewportHeight(window.innerHeight),
  );
}

// Shared peek-tick — every awaiting card refreshes its xterm tail on
// the same cadence, so one app-scoped timer fans out to N consumers
// instead of N independent timers. `createRoot` keeps the timer
// owner-detached so disposing any single card doesn't stop the tick.
const [peekTick, setPeekTick] = createSignal(0);
if (typeof window !== "undefined") {
  createRoot(() => {
    setInterval(() => setPeekTick((n) => n + 1), PEEK_REFRESH_MS);
  });
}

/** Collapsed = narrow strip of per-agent dots; expanded = full
 *  cards/pills. Per-device localStorage so a user's choice survives
 *  reloads but doesn't sync across machines (a 13" laptop might want
 *  collapsed while a 27" desktop stays expanded). Defaults to
 *  collapsed — ambient peripheral signal first, full context on
 *  demand via the rail toggle. */
const [dockCollapsed, setDockCollapsed] = makePersisted(createSignal(true), {
  name: "kolu-activity-dock-collapsed",
  serialize: (v) => (v ? "1" : "0"),
  deserialize: (raw) => raw === "1",
});

const ActivityDock: Component = () => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
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
        data-testid="activity-dock"
        data-collapsed={dockCollapsed() ? "" : undefined}
        class={`absolute top-20 left-4 z-20 rounded-2xl overflow-hidden shadow-2xl shadow-black/40 flex flex-col max-h-[calc(100vh-22rem)] ${dockCollapsed() ? "" : "w-72"}`}
      >
        <div class="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-none">
          <For each={liveIds()}>
            {(id) => <DockRow id={id} tailLines={tailLines()} />}
          </For>
        </div>
      </div>
    </Show>
  );
};

/** A row in the unified dock surface: rail-segment on the left
 *  (per-card `repoColor`, also the click target for collapse/expand)
 *  + content on the right (full card / working pill / nothing if
 *  collapsed). Rows stack with no gap so the rails form a continuous
 *  vertical stripe with color sections per terminal. */
const DockRow: Component<{ id: TerminalId; tailLines: number }> = (props) => {
  const store = useTerminalStore();
  const combined = createMemo(() => {
    const i = store.getDisplayInfo(props.id);
    const m = store.getMetadata(props.id);
    return i && m ? { info: i, meta: m } : null;
  });
  const bucket = createMemo(() => agentBucket(combined()?.meta.agent));
  return (
    <Show when={combined()}>
      {(c) => (
        <div class="flex flex-row items-stretch border-b border-edge/15 last:border-b-0">
          <RailSegment repoColor={c().info.repoColor} bucket={bucket()} />
          <Show when={!dockCollapsed()}>
            <div class="flex-1 min-w-0">
              <Show
                when={bucket() === "awaiting"}
                fallback={
                  <WorkingPillBody
                    id={props.id}
                    info={c().info}
                    meta={c().meta}
                  />
                }
              >
                <AwaitingCardBody
                  id={props.id}
                  info={c().info}
                  meta={c().meta}
                  tailLines={props.tailLines}
                />
              </Show>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
};

/** Colored rail segment — one per dock row. Clicking ANY segment
 *  toggles the dock between collapsed and expanded; that's why the
 *  separate chevron button is gone. The rail is wider in collapsed
 *  mode to give a comfortable click target and to read as identity
 *  swatches when there's no card next to it. A `dock-rail-*` filter
 *  animation cycles the segment's brightness so state-cadence
 *  (breathe / pulse) survives the unified-surface treatment. */
const RailSegment: Component<{ repoColor: string; bucket: string }> = (
  props,
) => {
  return (
    <button
      type="button"
      data-testid="activity-dock-toggle"
      data-agent-bucket={props.bucket}
      onClick={() => setDockCollapsed((v) => !v)}
      class={`shrink-0 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
        dockCollapsed() ? "w-6 h-6" : "w-1.5"
      } ${props.bucket === "awaiting" ? "dock-rail-awaiting" : "dock-rail-working"}`}
      style={{ "background-color": props.repoColor }}
      title={
        dockCollapsed() ? "Expand awaiting dock" : "Collapse awaiting dock"
      }
      aria-label={
        dockCollapsed() ? "Expand awaiting dock" : "Collapse awaiting dock"
      }
    />
  );
};

/** Awaiting card body — content for an awaiting row. No own chrome
 *  (rounding, border, shadow, width) — the unified `<ActivityDock>`
 *  outer surface provides all of those; the body just fills its grid
 *  cell with the tile-themed bg/fg + content layout. */
const AwaitingCardBody: Component<{
  id: TerminalId;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
  tailLines: number;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const [tail, setTail] = createSignal<string[]>([]);
  const [value, setValue] = createSignal("");

  createEffect(() => {
    peekTick();
    const xterm = getTerminalRefs(props.id)?.xterm;
    if (!xterm) {
      setTail([]);
      return;
    }
    setTail(tailBuffer(xterm, props.tailLines));
  });

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
    <div
      data-testid="activity-dock-card"
      data-terminal-id={props.id}
      class="px-2.5 py-2.5 flex flex-col gap-1.5"
      style={{
        "background-color": tileTheme(props.id).bg,
        color: tileTheme(props.id).fg,
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
            style={{ color: props.info.repoColor }}
          >
            {props.info.key.group}
          </span>
          <span
            class="text-[0.95rem] font-semibold leading-tight truncate min-w-0"
            style={{ color: props.info.branchColor }}
          >
            {props.info.key.label}
          </span>
        </div>
        <DockMetaRow meta={props.meta} />
        <PrLine meta={props.meta} />
        <Show when={tail().length > 0}>
          <div
            data-testid="activity-dock-tail"
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
          data-testid="activity-dock-reply"
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
};

/** Working pill body — compact row content for a `thinking`/`tool_use`
 *  terminal. Same no-own-chrome contract as the awaiting card body. */
const WorkingPillBody: Component<{
  id: TerminalId;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  return (
    <button
      type="button"
      data-testid="activity-dock-working"
      data-terminal-id={props.id}
      onClick={() => store.activate(props.id)}
      class="w-full px-2.5 py-1 flex flex-col gap-0.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 text-left"
      style={{
        "background-color": tileTheme(props.id).bg,
        color: tileTheme(props.id).fg,
      }}
      title="Jump to this terminal"
    >
      <div class="flex items-baseline justify-between gap-2 min-w-0">
        <span
          class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
          style={{ color: props.info.repoColor }}
        >
          {props.info.key.group}
        </span>
        <span
          class="text-[0.85rem] font-semibold leading-tight truncate min-w-0"
          style={{ color: props.info.branchColor }}
        >
          {props.info.key.label}
        </span>
      </div>
      <DockMetaRow meta={props.meta} />
      <PrLine meta={props.meta} />
    </button>
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
 *  the terminal has no agent — `<ActivityDock>` only mounts these
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

export default ActivityDock;
