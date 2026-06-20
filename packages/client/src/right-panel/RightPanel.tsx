/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs via the DU view exposed by
 *  `useRightPanel().activeTab()`.
 *
 *  Pure presenter — no shell positioning, no resize handle. The desktop
 *  host wraps this in a `@corvu/resizable` `Resizable` (in `App.tsx`)
 *  for the horizontal split + drag-to-resize; the mobile host wraps
 *  this in a `@corvu/drawer` (`RightPanelDrawer.tsx`). Both hosts thread
 *  the same `visible` accessor — desktop reads `collapsed()`, mobile
 *  reads `drawerOpen()` — so `inert` (and the `data-collapsed` marker)
 *  reflect actual visibility on both surfaces. `data-collapsed` is emitted
 *  when `!visible` so e2e selectors can assert collapse state without
 *  inspecting widths. */

import type {
  RightPanelTabKind,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  lazy,
  onMount,
  Show,
  Suspense,
} from "solid-js";
import { match } from "ts-pattern";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon } from "../ui/Icons";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import MetadataInspector from "./MetadataInspector";

// The Code tab pulls a heavy main-thread chunk — the Pierre `FileTree`, the
// `@kolu/solid-markdown` renderer (marked + DOMPurify), the diff/source view
// wrappers, and the comment system — ~171 kB gzip that a static import would
// weld onto the eager initial bundle for every session. Lazy-load it so that
// weight leaves the first-paint critical path: the chunk is fetched only once
// the Code tab is actually shown (see `codeEverShown`), and kept mounted after
// (so #818 state preservation across tab switches is unchanged). On a closed
// mobile drawer or a collapsed desktop panel it never loads at all.
const CodeTab = lazy(() => import("./CodeTab"));
import { useRightPanel } from "./useRightPanel";

/** Ordered tab kinds shown in the tab bar. Adding a new kind to the
 *  discriminated union requires a corresponding entry here AND in
 *  `TAB_LABEL` below — both are typed `Record<RightPanelTabKind, …>` and
 *  fail-compile on missing keys. The body renderer further down dispatches
 *  via `match(kind).exhaustive()`, which also fails-compile on a missing
 *  variant — so adding a new kind is a three-place change that the
 *  compiler enforces end-to-end. */
const TAB_KINDS: readonly RightPanelTabKind[] = ["code", "inspector"] as const;

const TAB_LABEL: Record<RightPanelTabKind, string> = {
  inspector: "Inspector",
  code: "Code",
};

const RightPanel: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
  /** Whether this `RightPanel` instance is visible to the user. The host
   *  decides — desktop reads `collapsed()`, mobile reads `drawerOpen()`. */
  visible: boolean;
}> = (props) => {
  const rightPanel = useRightPanel();

  const showKind = (kind: RightPanelTabKind) =>
    kind === "inspector" ? rightPanel.showInspector() : rightPanel.showCode();

  // "The given tab is the active tab" — the single per-kind active predicate,
  // read by the tab bar, the slot display-gate, and the Code load-gate below.
  const isActiveKind = (kind: RightPanelTabKind) =>
    rightPanel.activeTab().kind === kind;

  // The Code tab is live right now: the panel is visible AND it's the selected
  // tab. The reusable visibility+selection predicate — anything that needs "is
  // the code tab on screen" reads this.
  const codeShownNow = () => props.visible && isActiveKind("code");

  // `mounted` is the isolated deferral knob: it flips only after `onMount`, so
  // the initial synchronous paint never renders (and so never suspends on) the
  // lazy chunk — the terminal and chrome paint first, then the Code tab streams
  // in. The latch (`was ||`) is the lone first-load/keep-alive concern: true
  // once the Code tab has actually been shown, then never false again, so the
  // chunk mounts on first view and stays mounted. The kept-alive hidden sibling
  // (the `display:none` slot below) is what preserves the inactive tab's local
  // state (selected file, Pierre tree expansion, scroll) across a tab switch
  // exactly as the eagerly-mounted form did (#818). Until first view the chunk
  // stays off the network: a closed mobile drawer or collapsed desktop panel
  // (`!props.visible`) never loads it.
  const [mounted, setMounted] = createSignal(false);
  onMount(() => setMounted(true));
  const codeEverShown = createMemo(
    (was: boolean) => was || (mounted() && codeShownNow()),
    false,
  );

  return (
    <div
      data-testid="right-panel"
      data-collapsed={props.visible ? undefined : ""}
      class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0"
      // Panel stays mounted across collapse on desktop so CodeTab's local
      // state survives (#818); the desktop Resizable shrinks it to ~0 width
      // via `sizes=[1, 0]`. `inert` alone makes "not visible" mean "not
      // interactive": it both drops the subtree from the accessibility tree
      // and removes the Collapse button, tab buttons, and CodeTab inputs
      // from the Tab focus order (an invisible focus trap otherwise). We
      // deliberately omit a paired `aria-hidden`: the browser blocks
      // `aria-hidden` on an ancestor of a focused element (a focused
      // Collapse/tab button or CodeTab input when the panel collapses) and
      // logs a WAI-ARIA console warning — `inert` covers both concerns.
      inert={!props.visible}
    >
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 bg-surface-1 border-b border-edge">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <button
                type="button"
                data-testid={`right-panel-tab-${kind}`}
                data-active={isActive()}
                class={`h-full px-3 text-xs cursor-pointer transition-colors ${
                  isActive()
                    ? "font-medium text-fg-2 bg-surface-0 border-b-2"
                    : "text-fg-3/50 hover:text-fg-2 hover:bg-surface-0/50 border-b-2 border-transparent"
                }`}
                style={{
                  "border-bottom-color": isActive()
                    ? ACTIVE_TERMINAL_ACCENT
                    : undefined,
                }}
                onClick={() => showKind(kind)}
              >
                {TAB_LABEL[kind]}
              </button>
            );
          }}
        </For>
        <div class="flex-1" />
        <div class="flex items-center gap-0.5 pr-1">
          <button
            type="button"
            class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
            onClick={props.onToggle}
            aria-label="Collapse panel"
          >
            <ChevronRightIcon class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Both tab slots render side by side; the inactive one is display:none.
       *  The Inspector mounts eagerly; the Code tab mounts lazily on first view
       *  (`codeEverShown`) and is then KEPT mounted — so once opened, each tab's
       *  local state (CodeTab's selected file, Pierre's tree expansion, scroll
       *  position) survives a tab switch exactly as the always-mounted form did
       *  (#818). Wrapping a single `match(...).exhaustive()` over `activeTab()`
       *  would unmount the inactive sibling and discard that state. The
       *  shape below iterates `TAB_KINDS` (already compile-exhaustive over
       *  RightPanelTabKind via the `Record<RightPanelTabKind, …>` typings
       *  on TAB_LABEL) so both bodies mount once, then `match(kind)` picks
       *  which component to render per slot — exhaustive *and* both-mounted. */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <div
                class={isActive() ? "h-full" : "hidden"}
                aria-hidden={!isActive()}
              >
                {match(kind)
                  .with("inspector", () => (
                    <MetadataInspector
                      meta={props.meta}
                      terminalId={props.terminalId}
                      themeName={props.themeName}
                      onThemeClick={props.onThemeClick}
                    />
                  ))
                  .with("code", () => (
                    <Show when={codeEverShown()}>
                      <Suspense
                        fallback={
                          <div class="flex h-full items-center justify-center text-xs text-fg-3/50">
                            Loading…
                          </div>
                        }
                      >
                        <CodeTab
                          terminalId={props.terminalId}
                          meta={props.meta}
                        />
                      </Suspense>
                    </Show>
                  ))
                  .exhaustive()}
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default RightPanel;
