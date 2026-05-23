/** Dock — left-edge canonical live-terminal navigator.
 *
 *  Two progressive levels of detail, toggled in place. Per-device
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
 *
 *  Workspace search lives in the unified command palette (#912) — the
 *  dock's search-icon button delegates to `onOpenWorkspaceSearch`,
 *  which opens the palette pre-drilled into "Search workspaces".
 *  `Mod+Shift+K` reaches the same surface.
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
  createMemo,
  createSignal,
} from "solid-js";
import { toast } from "solid-sonner";
import IntentBody from "../../intent/IntentBody";
import AgentIndicator from "../../terminal/AgentIndicator";
import { formatTimeAgo, useStaleCheck } from "../../terminal/staleness";
import IntentGlyph from "../../intent/IntentGlyph";
import { IntentMarkdownInline } from "../../intent/IntentMarkdown";
import { annotationLine } from "../../intent/text";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "../../ui/Icons";
import { client } from "../../wire";
import { isPlatformModifier } from "../../input/keyboard";
import { useTileTheme } from "../useTileTheme";
import { useViewPosture } from "../useViewPosture";
import { resolvedPr } from "../dockModel";
import { type DockRowBucket, rankDockRows } from "./dockRowRanking";

export type DockMode = "rail" | "cards";

// 40px so the 24px-wide header buttons (`w-6`) + 8px of `px-1` padding
// fit without overflowing the rail's outer width.
const RAIL_WIDTH_PX = 40;
const CARDS_WIDTH_PX = 288;

/** Width in pixels for a given mode. Drives both the outer aside's
 *  inline `width` style and (in maximized posture) the dock's flex
 *  footprint as a left-panel sibling of the canvas. */
function dockWidth(mode: DockMode): number {
  return mode === "rail" ? RAIL_WIDTH_PX : CARDS_WIDTH_PX;
}

// Holding the platform modifier (Cmd on macOS, Ctrl elsewhere) reveals
// numeric hints over the first nine dock rows so the user can see what
// `Cmd+1..9` will target. Same modifier as the shortcut itself — the
// hint and the chord that fires it share one key, so users learn the
// mapping by holding-then-pressing without re-mapping a separate
// discovery modifier in their head. Module-scope so a single pair of
// window listeners fans out to every DockRow.
const [modHeld, setModHeld] = createSignal(false);
if (typeof window !== "undefined") {
  const refresh = (e: KeyboardEvent) => setModHeld(isPlatformModifier(e));
  const clear = () => setModHeld(false);
  window.addEventListener("keydown", refresh);
  window.addEventListener("keyup", refresh);
  // Tab-away can drop the keyup that would otherwise reset state; the
  // hint would visibly stick to "mod held" until the user re-focused
  // and pressed the modifier again. Blur and visibility-change both reset.
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
}

/** Two-state mode persisted per-device. `"cards"` is the default — the
 *  dock surfaces real context first, ambient compression on opt-in. */
export const [dockMode, setDockMode] = makePersisted(
  createSignal<DockMode>("cards"),
  {
    name: "kolu-dock-mode",
    serialize: (v) => v,
    deserialize: (raw): DockMode => (raw === "rail" ? raw : "cards"),
  },
);

/** Toggle the dock between rail (collapsed) and cards (expanded).
 *  Exported so the chrome-bar dock-toggle button and the
 *  `Cmd+Shift+B` keyboard shortcut can drive the same lifecycle as
 *  the dock-header chevron. */
export function toggleRailCards(): void {
  setDockMode(dockMode() === "rail" ? "cards" : "rail");
}

/** Read-only accessor for "is the dock expanded?" — true when in
 *  cards. Drives the chrome-bar toggle button's `active` pip so the
 *  icon reflects current state. */
export const dockExpanded = (): boolean => dockMode() !== "rail";

const Dock: Component<{
  /** Opens the command palette pre-drilled into "Search workspaces" —
   *  invoked by the dock's search-icon button. */
  onOpenWorkspaceSearch: () => void;
  onCreate: () => void;
}> = (props) => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  const posture = useViewPosture();

  const ranked = createMemo(() =>
    rankDockRows(store.terminalIds(), store.getMetadata, isStale),
  );

  const liveIds = createMemo(() => ranked().map((r) => r.id));
  const bucketOf = createMemo(() => {
    const map = new Map<TerminalId, DockRowBucket>();
    for (const r of ranked()) map.set(r.id, r.bucket);
    return map;
  });

  // Maximized = flush sidebar; tiled = floating overlay. Two distinct
  // shells share the same inner body so rendering logic stays singular.
  return (
    <Show when={liveIds().length > 0}>
      <aside
        data-testid="dock"
        data-mode={dockMode()}
        data-maximized={posture.maximized() ? "" : undefined}
        class="flex flex-col select-none overflow-hidden"
        classList={{
          // Tiled: absolute float inside the canvas; positions over
          // tiles rather than reflowing them.
          "absolute z-30 top-20 left-4 rounded-2xl shadow-2xl shadow-black/40":
            !posture.maximized(),
          "max-h-[calc(100vh-22rem)]": !posture.maximized(),
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
        <RailOrCards
          mode={dockMode()}
          liveIds={liveIds()}
          bucketOf={bucketOf()}
          onCreate={props.onCreate}
          onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
        />
      </aside>
    </Show>
  );
};

/** Rail / cards body — vertical stack of dock rows preceded by a header
 *  with the `+` new-terminal button and the mode chevron. */
const RailOrCards: Component<{
  mode: DockMode;
  liveIds: TerminalId[];
  bucketOf: Map<TerminalId, DockRowBucket>;
  onCreate: () => void;
  onOpenWorkspaceSearch: () => void;
}> = (props) => {
  return (
    <div class="flex flex-col w-full min-h-0">
      <DockHeader
        mode={props.mode}
        onCreate={props.onCreate}
        onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
      />
      <div class="flex flex-col overflow-y-auto overflow-x-hidden scrollbar-none flex-1 min-h-0">
        <For each={props.liveIds}>
          {(id, index) => (
            <DockRow
              id={id}
              bucket={props.bucketOf.get(id) ?? "none"}
              mode={props.mode}
              index={index()}
            />
          )}
        </For>
      </div>
    </div>
  );
};

/** Dock header — `+` new terminal, workspace-search trigger, and the
 *  rail ↔ cards mode toggle. Layout is row in cards mode (icons sit on
 *  one line at the top), column in rail mode (stacked vertically
 *  inside the narrow rail width). */
const DockHeader: Component<{
  mode: DockMode;
  onCreate: () => void;
  onOpenWorkspaceSearch: () => void;
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
        data-testid="dock-search"
        onClick={props.onOpenWorkspaceSearch}
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
  bucket: DockRowBucket;
  mode: DockMode;
  /** Zero-based row index in the recency-sorted list. Used to paint
   *  the `Cmd+1..9` hint on the first nine rows while Alt is held. */
  index: number;
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
  // First nine rows get a Cmd+i hint while the platform modifier is
  // held. The mapping matches `switchTo1..9` in `actions.ts`, which
  // targets the same dock row order this row's `index` belongs to.
  const showShortcutHint = () => modHeld() && props.index < 9;
  return (
    <Show when={combined()}>
      {(c) => (
        <div
          class="flex flex-row items-stretch border-b border-edge/15 last:border-b-0 relative transition-[margin,border-radius,box-shadow] duration-300 ease-out data-[active]:m-1.5 data-[active]:rounded-lg data-[active]:border-b-transparent data-[active]:shadow-[var(--dock-active-halo)] data-[active]:animate-[dock-row-activate_0.36s_cubic-bezier(0.34,1.45,0.6,1),dock-row-flash_0.48s_ease-out] motion-reduce:transition-none motion-reduce:data-[active]:animate-none"
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
          {/* Active-terminal indicator lives in index.css, keyed on
           *  `[data-testid="dock-row"][data-active]` (set on the row
           *  above). Lifted-card geometry + accent flood + one-shot
           *  pop-in animation — see the "Active dock row" section in
           *  `index.css`. Mobile drawer shares the same CSS block via
           *  its own `[data-testid="mobile-dock-row"][data-active]`. */}
          <Show when={showShortcutHint()}>
            <span
              data-testid="dock-row-shortcut-hint"
              class="absolute top-1 left-1 z-10 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded bg-accent text-surface-1 font-mono text-[0.6rem] font-bold tabular-nums pointer-events-none"
              aria-hidden="true"
            >
              {props.index + 1}
            </span>
          </Show>
          <RailSegment
            id={props.id}
            repoColor={c().info.repoColor}
            bucket={props.bucket}
            mode={props.mode}
            intent={c().meta.intent}
          />
          <Show when={props.mode === "cards"}>
            <div class="flex-1 min-w-0">
              <RowBody
                id={props.id}
                bucket={props.bucket}
                info={c().info}
                meta={c().meta}
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
  bucket: DockRowBucket;
  mode: DockMode;
  intent: string | undefined;
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
      class={`shrink-0 cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 flex items-center justify-center ${
        props.mode === "rail" ? "w-full h-6" : "w-1.5"
      } ${animClass()}`}
      classList={{
        "opacity-50": props.bucket === "parked" || props.bucket === "none",
      }}
      style={{ "background-color": props.repoColor }}
      title="Jump to this terminal"
      aria-label="Jump to this terminal"
    >
      <Show when={props.mode === "rail" && props.intent}>
        <IntentGlyph
          intent={props.intent}
          class="block text-base leading-none mix-blend-multiply"
        />
      </Show>
    </button>
  );
};

/** Annotation slot shared by all three Dock body variants — renders
 *  intent line-1 (or the branch-name fallback) as inline markdown with
 *  the slot's tint color.  Only the font-size class varies per variant. */
const DockAnnotation: Component<{
  meta: TerminalMetadata;
  info: TerminalDisplayInfo;
  class: string;
  active: boolean;
}> = (props) => (
  <span
    data-testid="dock-annotation"
    class={`${props.class} truncate min-w-0`}
    // Drop the inline color when active so the parent body's white
    // cascades through — an inline annotationColor wins against
    // `!important` via specificity; undefined removes the inline.
    style={{ color: props.active ? undefined : props.info.annotationColor }}
  >
    <IntentMarkdownInline
      markdown={annotationLine(props.meta.intent, props.info.key.label)}
    />
  </span>
);

/** Dispatches each row to its variant body. Bundling the variant switch
 *  in one place keeps `DockRow` shape uniform — every bucket has the
 *  same outer "rail + body" geometry regardless of which variant the
 *  body renders. Each body derives its own `active` state from the
 *  terminal store — no prop threading needed since all three already
 *  call `useTerminalStore()` and have `props.id`. */
const RowBody: Component<{
  id: TerminalId;
  bucket: DockRowBucket;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
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
        <AwaitingCardBody id={props.id} info={props.info} meta={props.meta} />
      </Match>
      <Match when={props.bucket === "working"}>
        <WorkingPillBody id={props.id} info={props.info} meta={props.meta} />
      </Match>
    </Switch>
  );
};

/** Awaiting card body — content for an awaiting row.
 *
 *  Replaces the previous xterm-buffer-tail render with the terminal's
 *  intent markdown. Rationale: the agent's live state is already
 *  communicated by the bucket pulse + `DockMetaRow`; what's missing in
 *  a busy dock is *which* terminal this is — the user's intent note is
 *  exactly that, and it stays stable while the buffer below it
 *  scrolls. When intent is unset the card collapses to header + reply. */
const AwaitingCardBody: Component<{
  id: TerminalId;
  info: TerminalDisplayInfo;
  meta: TerminalMetadata;
}> = (props) => {
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const theme = createMemo(() => tileTheme(props.id));
  const active = () => store.activeId() === props.id;
  const [value, setValue] = createSignal("");

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
      class="px-2.5 py-2.5 flex flex-col gap-1.5 transition-colors duration-200 ease-out"
      classList={{
        // Active body floods to accent → main text inherits white,
        // and the dim subtitle utilities (`text-fg-2`, `text-fg-3`)
        // get brightened via descendant overrides so the PR line,
        // timestamp, and agent-indicator token count stay readable
        // against the accent flood. CSS specificity ensures the
        // descendant arbitrary selectors win over the bare
        // `.text-fg-*` utilities.
        "text-white [&_.text-fg-2]:text-white/85 [&_.text-fg-3]:text-white/70":
          active(),
      }}
      style={{
        "background-color": active() ? "var(--color-accent)" : theme().bg,
        color: active() ? undefined : theme().fg,
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
            style={{
              color: active() ? undefined : props.info.repoColor,
            }}
          >
            {props.info.key.group}
          </span>
          <DockAnnotation
            meta={props.meta}
            info={props.info}
            class="text-[0.95rem] font-semibold leading-tight"
            active={active()}
          />
        </div>
        <DockMetaRow meta={props.meta} />
        <PrLine meta={props.meta} />
        <IntentBody intent={props.meta.intent} testId="dock-intent" />
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
  const active = () => store.activeId() === props.id;
  return (
    <button
      type="button"
      data-testid="dock-working"
      data-terminal-id={props.id}
      onClick={() => store.activate(props.id)}
      class="w-full px-2.5 py-1 flex flex-col gap-0.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 text-left transition-colors duration-200 ease-out"
      classList={{
        // Active body floods to accent → main text inherits white,
        // and the dim subtitle utilities (`text-fg-2`, `text-fg-3`)
        // get brightened via descendant overrides so the PR line,
        // timestamp, and agent-indicator token count stay readable
        // against the accent flood. CSS specificity ensures the
        // descendant arbitrary selectors win over the bare
        // `.text-fg-*` utilities.
        "text-white [&_.text-fg-2]:text-white/85 [&_.text-fg-3]:text-white/70":
          active(),
      }}
      style={{
        "background-color": active() ? "var(--color-accent)" : theme().bg,
        color: active() ? undefined : theme().fg,
      }}
      title="Jump to this terminal"
    >
      <div class="flex items-baseline justify-between gap-2 min-w-0">
        <span
          class="font-mono text-[0.65rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
          style={{
            color: active() ? undefined : props.info.repoColor,
          }}
        >
          {props.info.key.group}
        </span>
        <DockAnnotation
          meta={props.meta}
          info={props.info}
          class="text-[0.85rem] font-semibold leading-tight"
          active={active()}
        />
      </div>
      <DockMetaRow meta={props.meta} />
      <PrLine meta={props.meta} />
      <IntentBody intent={props.meta.intent} testId="dock-intent" />
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
  bucket: DockRowBucket;
}> = (props) => {
  const store = useTerminalStore();
  const active = () => store.activeId() === props.id;
  const foreground = () =>
    props.meta.foreground?.title ?? props.meta.foreground?.name ?? null;
  return (
    <button
      type="button"
      data-testid="dock-quiet"
      data-terminal-id={props.id}
      data-bucket={props.bucket}
      onClick={() => store.activate(props.id)}
      class="w-full px-2.5 py-1 flex flex-col gap-0.5 min-w-0 cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 transition-colors duration-200 ease-out"
      classList={{
        "bg-surface-1/40 hover:bg-surface-2/50": !active(),
        "bg-accent text-white [&_.text-fg-2]:text-white/85 [&_.text-fg-3]:text-white/70":
          active(),
        // Parked dim only when not active; an active parked row pops
        // at full opacity, matching the existing mobile behavior at
        // `MobileDockDrawer.tsx`.
        "opacity-60": props.bucket === "parked" && !active(),
      }}
      title={props.info.meta.cwd}
    >
      <div class="flex items-baseline gap-2 min-w-0">
        <span
          class="font-mono text-[0.6rem] font-bold uppercase tracking-[0.14em] truncate min-w-0"
          style={{
            color: active() ? undefined : props.info.repoColor,
          }}
        >
          {props.info.key.group}
        </span>
        <DockAnnotation
          meta={props.meta}
          info={props.info}
          class="text-[0.75rem]"
          active={active()}
        />
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
      <IntentBody intent={props.meta.intent} testId="dock-intent" />
    </button>
  );
};

/** GitHub PR summary line (when one is resolved). */
const PrLine: Component<{ meta: TerminalMetadata }> = (props) => {
  const pr = () => resolvedPr(props.meta.pr);
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

export default Dock;
