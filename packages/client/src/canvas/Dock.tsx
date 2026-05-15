/** Dock — left-edge canonical live-terminal navigator.
 *
 *  Three progressive levels of detail, toggled in place. Per-device
 *  `dockMode` persists across reloads so a 13" laptop can stay on the
 *  rail while a 27" desktop sits on cards.
 *
 *  1. **rail** — narrow strip of repo-colored swatches, one per live
 *     terminal. State-cadenced (breathe / pulse) via `dock-rail-*`
 *     animations. Click any swatch to expand; click the chevron at the
 *     top to switch to cards.
 *  2. **cards** (default) — recency-sorted variant rows: awaiting
 *     terminals get full cards with xterm-buffer tail + reply input;
 *     working terminals get compact pills; idle terminals get a faded
 *     row; parked (`isStale`) terminals get a tiny dimmed row.
 *  3. **mega** — search + repo-facets + agent-state columns. Same
 *     content the chrome-bar workspace switcher used to host, now
 *     anchored to the dock. Opens on `Mod+Shift+K` (the openRequest
 *     impulse) and on the chevron-up affordance from cards.
 *
 *  In maximized-tile mode the dock renders as a flush left-edge sidebar
 *  with opaque background, full canvas height, separator on the right.
 *  The maximized tile reflows next to it (CanvasTile reads
 *  `dockMaximizedWidth`). In tiled mode the dock floats over the canvas
 *  with the existing radius/shadow surface.
 *
 *  Auto-hides only when the workspace has no terminals — once the user
 *  has any terminal at all, the dock stays on screen, since it is the
 *  primary navigator. */

import { makePersisted } from "@solid-primitives/storage";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { toast } from "solid-sonner";
import AgentIndicator from "../terminal/AgentIndicator";
import { tailBuffer } from "../terminal/bufferTail";
import {
  formatTimeAgo,
  useIdleClassifier,
  useStaleCheck,
} from "../terminal/staleness";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { getTerminalRefs } from "../terminal/terminalRefs";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "../ui/Icons";
import { client } from "../wire";
import { useTileTheme } from "./useTileTheme";
import { useViewPosture } from "./useViewPosture";
import {
  agentBucket,
  buildWorkspaceSwitcherModel,
  type WorkspaceSwitcherSourceEntry,
} from "./workspace-switcher";
import WorkspaceSearchPanel from "./workspace-switcher/SearchPanel";

export type DockMode = "rail" | "cards" | "mega";

/** Per-card render variant. `parked` is its own bucket (not folded into
 *  idle) because it carries a different visual treatment (faded, tinier
 *  row) and routes through staleness, not the idle-bucket classifier. */
type DockBucket = "awaiting" | "working" | "idle" | "parked" | "none";

const PEEK_REFRESH_MS = 250;
const MIN_TAIL_LINES = 2;
const MAX_TAIL_LINES = 7;
// 40px so the 24px-wide header buttons (`w-6`) + 8px of `px-1` padding
// fit without overflowing the rail's outer width.
const RAIL_WIDTH_PX = 40;
const CARDS_WIDTH_PX = 288;
// Mega has a 12rem (192px) repo sidebar plus four agent-state columns.
// 560px squeezed the column labels into wraps ("Awaiting / you",
// "Working / 00", "No / agent"). 960px gives each column ~180px of
// minimum width — enough for the column header + a single card per
// row without truncation, matching the breathing room the retired
// chrome-bar workspace switcher had.
const MEGA_WIDTH_PX = 960;

/** Sort priority for rows that share `lastActivityAt` (most commonly
 *  several plain shells at `ts === 0`). Lower comes first. Module-scope
 *  so it isn't re-allocated on every `ranked()` recomputation. */
const BUCKET_PRIORITY: Record<DockBucket, number> = {
  awaiting: 0,
  working: 1,
  idle: 2,
  parked: 3,
  none: 4,
};

/** Width in pixels for a given mode. Drives both the outer aside's
 *  inline `width` style and (in maximized posture) the dock's flex
 *  footprint as a left-panel sibling of the canvas. */
function dockWidth(mode: DockMode): number {
  if (mode === "rail") return RAIL_WIDTH_PX;
  if (mode === "mega") return MEGA_WIDTH_PX;
  return CARDS_WIDTH_PX;
}

/** Per-card tail budget shrinks as the dock fills.
 *
 *  Each card has ~120px of fixed chrome (eyebrow + agent row + reply
 *  input + padding); tail lines add ~18px each. Subtract a top-offset
 *  + bottom-margin reserve (~200px), divide the remaining height
 *  across the visible cards, then floor to a line count. */
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
// signal itself (browser session) rather than `Dock`'s mount —
// otherwise a resize while the dock is auto-hidden (no terminals) would
// leave `viewportHeight` stale.
const [viewportHeight, setViewportHeight] = createSignal(
  typeof window === "undefined" ? 1000 : window.innerHeight,
);
if (typeof window !== "undefined") {
  window.addEventListener("resize", () =>
    setViewportHeight(window.innerHeight),
  );
}

// Shared peek-tick — every awaiting card refreshes its xterm tail on
// the same cadence, so one app-scoped timer fans out to N consumers.
const [peekTick, setPeekTick] = createSignal(0);
if (typeof window !== "undefined") {
  createRoot(() => {
    setInterval(() => setPeekTick((n) => n + 1), PEEK_REFRESH_MS);
  });
}

/** Tri-state mode persisted per-device. `"cards"` is the default — the
 *  dock surfaces real context first, ambient compression on opt-in.
 *  Mega is a transient search affordance and deliberately doesn't
 *  round-trip: if the user closes the dock from mega and reloads,
 *  they should land back on rail/cards, not in the search overlay
 *  staring at an unfocused input. */
export const [dockMode, setDockMode] = makePersisted(
  createSignal<DockMode>("cards"),
  {
    name: "kolu-dock-mode",
    serialize: (v) => v,
    deserialize: (raw): DockMode => (raw === "rail" ? raw : "cards"),
  },
);

/** Remember which non-mega mode we came from so closing mega returns
 *  to it. Plain in-memory signal: the persisted `dockMode` only stores
 *  rail/cards (mega never round-trips), so this is the only place that
 *  tracks the pre-mega level. */
const [previousMode, setPreviousMode] =
  createSignal<Exclude<DockMode, "mega">>("cards");

function openMega(): void {
  const current = dockMode();
  if (current !== "mega") setPreviousMode(current as Exclude<DockMode, "mega">);
  setDockMode("mega");
}

function closeMega(): void {
  setDockMode(previousMode());
}

/** Toggle the dock between rail (collapsed) and cards (expanded).
 *  Mega mode closes back to its prior level first. Exported so the
 *  chrome-bar dock-toggle button and the `Cmd+B` keyboard shortcut
 *  can drive the same lifecycle as the dock-header chevron. */
export function toggleRailCards(): void {
  if (dockMode() === "mega") {
    closeMega();
    return;
  }
  setDockMode(dockMode() === "rail" ? "cards" : "rail");
}

/** Read-only accessor for "is the dock expanded?" — true when in
 *  cards or mega. Drives the chrome-bar toggle button's `active`
 *  pip so the icon reflects current state. */
export const dockExpanded = (): boolean => dockMode() !== "rail";

const Dock: Component<{
  entries: WorkspaceSwitcherSourceEntry[];
  activeId: TerminalId | null;
  getRecency: (id: TerminalId) => number;
  /** Increments to request mega open (Mod+Shift+K from anywhere). */
  openMegaRequest: number;
  onCreate: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  const posture = useViewPosture();

  const ranked = createMemo(() => {
    const result: {
      id: TerminalId;
      bucket: DockBucket;
      ts: number;
    }[] = [];
    for (const id of store.terminalIds()) {
      const meta = store.getMetadata(id);
      if (!meta) continue;
      const parked = isStale(meta.lastActivityAt);
      const agent = agentBucket(meta.agent);
      // Parked is its own bucket. An "awaiting" agent that's been
      // parked for hours is no longer "awaiting" in any actionable
      // sense — route it to parked so the row reads dim and small.
      let bucket: DockBucket;
      if (parked) bucket = "parked";
      else if (agent === "none") bucket = "none";
      else if (agent === "awaiting") bucket = "awaiting";
      else bucket = "working";
      // Idle vs none: a terminal that *has* an agent but no live
      // attention state (none) reads as "idle" in the dock — a quieter
      // row than a working pill. Plain shells (`lastActivityAt === 0`)
      // route to `none`.
      if (bucket === "none" && meta.lastActivityAt > 0) bucket = "idle";
      result.push({ id, bucket, ts: meta.lastActivityAt });
    }
    // Recency descending; secondary sort by bucket priority so
    // never-touched plain shells don't outrank an idle terminal with
    // the same `ts === 0`.
    result.sort((a, b) => {
      if (a.ts !== b.ts) return b.ts - a.ts;
      return BUCKET_PRIORITY[a.bucket] - BUCKET_PRIORITY[b.bucket];
    });
    return result;
  });

  const liveIds = createMemo(() => ranked().map((r) => r.id));
  const bucketOf = createMemo(() => {
    const map = new Map<TerminalId, DockBucket>();
    for (const r of ranked()) map.set(r.id, r.bucket);
    return map;
  });

  const awaitingCount = createMemo(
    () => ranked().filter((r) => r.bucket === "awaiting").length,
  );
  const tailLines = createMemo(() =>
    tailLinesFor(viewportHeight(), awaitingCount()),
  );

  // Shortcut opens mega. Focus-on-open is owned by MegaBody — it reads
  // `openMegaRequest` and re-focuses the search input on every impulse
  // (mount or subsequent shortcut while mega is already open). Keeping
  // the open + focus halves co-located inside the mega component keeps
  // the mega activity's volatility encapsulated; Dock just
  // orchestrates the rail/cards/mega level transitions.
  createEffect(
    on(
      () => props.openMegaRequest,
      () => openMega(),
      { defer: true },
    ),
  );

  // Esc closes mega; click outside (mousedown) closes mega. Same
  // dismissal grammar the chrome-bar switcher used.
  let containerRef: HTMLElement | undefined;
  onMount(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dockMode() === "mega") {
        closeMega();
        e.preventDefault();
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (dockMode() !== "mega" || !containerRef) return;
      if (!containerRef.contains(e.target as Node)) closeMega();
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleMouseDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleMouseDown);
    });
  });

  const selectAndClose = (id: TerminalId) => {
    store.activate(id);
    closeMega();
  };

  // Maximized = flush sidebar; tiled = floating overlay. Two distinct
  // shells share the same inner body so rendering logic stays singular.
  return (
    <Show when={liveIds().length > 0}>
      <aside
        ref={(el) => {
          containerRef = el;
        }}
        data-testid="dock"
        data-mode={dockMode()}
        data-maximized={posture.maximized() ? "" : undefined}
        // Open flag mirrors the chrome-bar switcher's `data-open` —
        // CSS hooks (chrome-bar surface emergence, etc.) keep working
        // unchanged on consumers that filter on `[data-open]`.
        data-open={dockMode() === "mega" ? "" : undefined}
        class="flex flex-col select-none overflow-hidden"
        classList={{
          // Tiled: absolute float inside the canvas; positions over
          // tiles rather than reflowing them.
          "absolute z-30 top-20 left-4 rounded-2xl shadow-2xl shadow-black/40":
            !posture.maximized(),
          // Tiled-mode height budget — mega gets more room (4-column
          // card grid), cards/rail stays compact.
          "max-h-[calc(100vh-22rem)]":
            !posture.maximized() && dockMode() !== "mega",
          "max-h-[calc(100vh-6rem)]":
            !posture.maximized() && dockMode() === "mega",
          // Maximized: real left-panel flex sibling of the canvas. The
          // canvas takes the remaining space via `flex-1` next to us
          // (see TerminalCanvas). Full canvas height comes from the
          // parent flex container (`stretch` is the default
          // `align-items`); a right-edge separator reads as a hard
          // panel boundary rather than a floating card.
          "relative shrink-0 h-full border-r border-edge bg-surface-1":
            posture.maximized(),
        }}
        style={{ width: `${dockWidth(dockMode())}px` }}
      >
        <Show
          when={dockMode() === "mega"}
          fallback={
            <RailOrCards
              mode={dockMode() as Exclude<DockMode, "mega">}
              liveIds={liveIds()}
              bucketOf={bucketOf()}
              tailLines={tailLines()}
              onCreate={props.onCreate}
              onOpenMega={openMega}
            />
          }
        >
          <MegaBody
            entries={props.entries}
            activeId={props.activeId}
            getRecency={props.getRecency}
            openRequest={props.openMegaRequest}
            onSelect={selectAndClose}
            onClose={closeMega}
          />
        </Show>
      </aside>
    </Show>
  );
};

/** Rail / cards body — vertical stack of dock rows preceded by a header
 *  with the `+` new-terminal button and the mode chevron. */
const RailOrCards: Component<{
  mode: Exclude<DockMode, "mega">;
  liveIds: TerminalId[];
  bucketOf: Map<TerminalId, DockBucket>;
  tailLines: number;
  onCreate: () => void;
  onOpenMega: () => void;
}> = (props) => {
  return (
    <div class="flex flex-col w-full min-h-0">
      <DockHeader
        mode={props.mode}
        onCreate={props.onCreate}
        onOpenMega={props.onOpenMega}
      />
      <div class="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-none flex-1 min-h-0">
        <For each={props.liveIds}>
          {(id) => (
            <DockRow
              id={id}
              bucket={props.bucketOf.get(id) ?? "none"}
              mode={props.mode}
              tailLines={props.tailLines}
            />
          )}
        </For>
      </div>
    </div>
  );
};

/** Dock header — `+` new terminal, mega-search trigger, and the rail
 *  ↔ cards mode toggle. Layout is row in cards mode (icons sit on one
 *  line at the top), column in rail mode (stacked vertically inside
 *  the narrow rail width). */
const DockHeader: Component<{
  mode: Exclude<DockMode, "mega">;
  onCreate: () => void;
  onOpenMega: () => void;
}> = (props) => {
  const railLayout = () => props.mode === "rail";
  return (
    <div
      class="flex items-center gap-1 px-1 py-1 border-b border-edge/40 shrink-0"
      classList={{ "flex-col": railLayout() }}
    >
      <button
        type="button"
        data-testid="dock-new"
        onClick={props.onCreate}
        class="group/new flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="New terminal"
        title="New terminal"
      >
        <PlusIcon class="w-3.5 h-3.5 transition-transform duration-200 group-hover/new:rotate-90" />
      </button>
      <button
        type="button"
        data-testid="dock-mega-toggle"
        onClick={props.onOpenMega}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 active:bg-surface-2 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-label="Search workspaces"
        title="Search workspaces (⌘⇧K)"
      >
        <SearchIcon class="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        data-testid="dock-mode-toggle"
        onClick={toggleRailCards}
        class="flex items-center justify-center w-6 h-6 rounded-md cursor-pointer text-fg-3 hover:text-fg hover:bg-surface-2/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        classList={{ "ml-auto": !railLayout() }}
        aria-label={railLayout() ? "Expand to cards" : "Collapse to rail"}
        title={railLayout() ? "Expand to cards" : "Collapse to rail"}
      >
        <span
          class="inline-flex"
          classList={{
            "rotate-90": !railLayout(),
            "-rotate-90": railLayout(),
          }}
        >
          <ChevronDownIcon class="w-3.5 h-3.5" />
        </span>
      </button>
    </div>
  );
};

/** A row in the unified dock surface: rail-segment on the left
 *  (per-card `repoColor`, also the click target for collapse/expand)
 *  + content on the right (full card / pill / idle row / parked row /
 *  nothing if rail).
 *
 *  Carries the surface-agnostic "list of live terminals" semantics that
 *  the chrome-bar workspace-switcher pill row used to own: same
 *  `data-active` / `data-unread` / `data-agent-state` attributes so
 *  step definitions and the activity-alerts pipeline can keep treating
 *  the dock row as "the entry for this terminal" without caring which
 *  surface hosts it. */
const DockRow: Component<{
  id: TerminalId;
  bucket: DockBucket;
  mode: Exclude<DockMode, "mega">;
  tailLines: number;
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
  return (
    <Show when={combined()}>
      {(c) => (
        <div
          class="flex flex-row items-stretch border-b border-edge/15 last:border-b-0 relative"
          data-testid="dock-row"
          data-terminal-id={props.id}
          data-bucket={props.bucket}
          data-agent-state={c().meta.agent?.state}
          data-active={active() ? "" : undefined}
          data-unread={unread() ? "" : undefined}
        >
          <Show when={unread()}>
            <span
              class="absolute -top-1 right-1 inline-flex h-2 w-2"
              aria-hidden="true"
            >
              <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
              <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
            </span>
          </Show>
          <RailSegment
            id={props.id}
            repoColor={c().info.repoColor}
            bucket={props.bucket}
            mode={props.mode}
          />
          <Show when={props.mode === "cards"}>
            <div class="flex-1 min-w-0">
              <RowBody
                id={props.id}
                bucket={props.bucket}
                info={c().info}
                meta={c().meta}
                tailLines={props.tailLines}
              />
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
};

/** Colored rail segment — one per dock row. Clicking the segment
 *  activates the corresponding terminal (in rail mode this is the only
 *  visible click target for the row; in cards mode the body has its
 *  own activator and the rail is a slim affordance to the side). The
 *  rail/cards mode toggle lives on the header chevron, not here. A
 *  `dock-rail-*` filter animation cycles the segment's brightness so
 *  state-cadence (breathe / pulse) survives the unified-surface
 *  treatment. */
const RailSegment: Component<{
  id: TerminalId;
  repoColor: string;
  bucket: DockBucket;
  mode: Exclude<DockMode, "mega">;
}> = (props) => {
  const store = useTerminalStore();
  // The breath/pulse animation belongs only to live attention states.
  // Idle/parked/none rails stay flat so the visual budget reads "live
  // signal here" without false positives. Accessor (not const) so the
  // class re-evaluates when `props.bucket` changes — `props` is reactive,
  // a plain `const` would capture the bucket at mount and the animation
  // would stick to a stale state across awaiting → working → idle
  // transitions.
  const animClass = () =>
    props.bucket === "awaiting"
      ? "dock-rail-awaiting"
      : props.bucket === "working"
        ? "dock-rail-working"
        : "";
  return (
    <button
      type="button"
      data-testid="dock-rail"
      data-agent-bucket={props.bucket}
      onClick={() => store.activate(props.id)}
      class={`shrink-0 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
        props.mode === "rail" ? "w-6 h-6" : "w-1.5"
      } ${animClass()}`}
      classList={{
        "opacity-50": props.bucket === "parked" || props.bucket === "none",
      }}
      style={{ "background-color": props.repoColor }}
      title="Jump to this terminal"
      aria-label="Jump to this terminal"
    />
  );
};

/** Dispatches each row to its variant body. Bundling the variant switch
 *  in one place keeps `DockRow` shape uniform — every bucket has the
 *  same outer "rail + body" geometry regardless of which variant the
 *  body renders. */
const RowBody: Component<{
  id: TerminalId;
  bucket: DockBucket;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
  tailLines: number;
}> = (props) => {
  return (
    <Switch
      fallback={
        <QuietRowBody
          id={props.id}
          info={props.info}
          meta={props.meta}
          bucket={props.bucket}
        />
      }
    >
      <Match when={props.bucket === "awaiting"}>
        <AwaitingCardBody
          id={props.id}
          info={props.info}
          meta={props.meta}
          tailLines={props.tailLines}
        />
      </Match>
      <Match when={props.bucket === "working"}>
        <WorkingPillBody id={props.id} info={props.info} meta={props.meta} />
      </Match>
    </Switch>
  );
};

/** Awaiting card body — content for an awaiting row. */
const AwaitingCardBody: Component<{
  id: TerminalId;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
  tailLines: number;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const theme = createMemo(() => tileTheme(props.id));
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
    // INVARIANT: TUI agents that ship distinct parsers for text and
    // CR (Codex Ratatui is the known case) require text+CR to arrive
    // as TWO separate PTY writes spaced ≥50ms apart.
    const ok = await client.terminal
      .sendInput({ id: props.id, data: text })
      .then(() => true)
      .catch((err: Error) => {
        toast.error(`Failed to send input: ${err.message}`);
        return false;
      });
    if (!ok) return;
    setValue("");
    setTimeout(() => {
      void client.terminal
        .sendInput({ id: props.id, data: "\r" })
        .catch((err: Error) => {
          toast.error(`Failed to send CR: ${err.message}`);
        });
    }, 50);
  }

  return (
    <div
      data-testid="dock-card"
      data-terminal-id={props.id}
      class="px-2.5 py-2.5 flex flex-col gap-1.5"
      style={{
        "background-color": theme().bg,
        color: theme().fg,
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
            data-testid="dock-tail"
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
          data-testid="dock-reply"
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
 *  terminal. */
const WorkingPillBody: Component<{
  id: TerminalId;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const theme = createMemo(() => tileTheme(props.id));
  return (
    <button
      type="button"
      data-testid="dock-working"
      data-terminal-id={props.id}
      onClick={() => store.activate(props.id)}
      class="w-full px-2.5 py-1 flex flex-col gap-0.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 text-left"
      style={{
        "background-color": theme().bg,
        color: theme().fg,
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

/** Quiet row — idle / parked / none. Compact variant with repo +
 *  branch on row 1; when the terminal is running a foreground process
 *  (e.g. `pu connect srid1`, `nix build`, `npm run dev`), a second
 *  row surfaces that title so plain shells aren't reduced to bare
 *  `~ ~` labels. Falls back to the branch row alone when no
 *  foreground is running. Faded for parked. */
const QuietRowBody: Component<{
  id: TerminalId;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
  bucket: DockBucket;
}> = (props) => {
  const store = useTerminalStore();
  const foreground = () =>
    props.meta.foreground?.title ?? props.meta.foreground?.name ?? null;
  return (
    <button
      type="button"
      data-testid="dock-quiet"
      data-terminal-id={props.id}
      data-bucket={props.bucket}
      onClick={() => store.activate(props.id)}
      class="w-full px-2.5 py-1 flex flex-col gap-0.5 min-w-0 cursor-pointer text-left bg-surface-1/40 hover:bg-surface-2/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      classList={{ "opacity-60": props.bucket === "parked" }}
      title={props.info.meta.cwd}
    >
      <div class="flex items-baseline gap-2 min-w-0">
        <span
          class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
          style={{ color: props.info.repoColor }}
        >
          {props.info.key.group}
        </span>
        <span
          class="text-[0.75rem] truncate min-w-0"
          style={{ color: props.info.branchColor }}
        >
          {props.info.key.label}
        </span>
        <Show when={formatTimeAgo(props.meta.lastActivityAt)}>
          {(label) => (
            <span class="ml-auto font-mono text-[0.55rem] tabular-nums text-fg-3 shrink-0">
              {label()}
            </span>
          )}
        </Show>
      </div>
      <Show when={foreground()}>
        {(fg) => (
          <span
            data-testid="dock-quiet-foreground"
            class="font-mono text-[0.65rem] text-fg-2 truncate min-w-0"
          >
            {fg()}
          </span>
        )}
      </Show>
    </button>
  );
};

/** GitHub PR summary line (when one is resolved). */
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

/** Shared "agent indicator (left) + lastActive (right)" sub-line. */
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

/** Mega level body — owns the search query, repo filter, and the
 *  focus-on-open impulse. Dock's only responsibility for mega
 *  is mounting this component (mode transition) and providing
 *  `onSelect` / `onClose` callbacks; the search activity's volatility
 *  stays here. `openRequest` bumps re-focus the search input on every
 *  impulse, so pressing the shortcut while mega is already open
 *  re-anchors the cursor in the search field. */
const MegaBody: Component<{
  entries: WorkspaceSwitcherSourceEntry[];
  activeId: TerminalId | null;
  getRecency: (id: TerminalId) => number;
  openRequest: number;
  onSelect: (id: TerminalId) => void;
  onClose: () => void;
}> = (props) => {
  const idleClassifier = useIdleClassifier();
  const [query, setQuery] = createSignal("");
  const [repoFilter, setRepoFilter] = createSignal<string | null>(null);
  // Initially true so the search input picks up focus on first mount
  // (the transition from rail/cards → mega). Re-focus on subsequent
  // impulses below.
  const [focusSearch, setFocusSearch] = createSignal(true);
  const model = createMemo(() =>
    buildWorkspaceSwitcherModel(props.entries, {
      query: query(),
      repoFilter: repoFilter(),
      activeId: props.activeId,
      getRecency: props.getRecency,
      idleClassifier,
    }),
  );

  // External impulse → re-focus. `defer: true` skips the initial
  // synchronous fire so the mount-time `focusSearch=true` default
  // owns first-mount focus instead of fighting with this effect.
  createEffect(
    on(
      () => props.openRequest,
      () => setFocusSearch(true),
      { defer: true },
    ),
  );

  return (
    <div class="w-full">
      <WorkspaceSearchPanel
        model={model()}
        query={query()}
        focusSearch={focusSearch()}
        onQueryChange={setQuery}
        onSearchFocused={() => setFocusSearch(false)}
        onRepoFilterChange={setRepoFilter}
        onSelect={props.onSelect}
        onClose={props.onClose}
      />
    </div>
  );
};

export default Dock;
