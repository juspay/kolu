/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs via the DU view exposed by
 *  `useRightPanel().activeTab()`. */

import type {
  RightPanelTabKind,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import { type Component, For } from "solid-js";
import { match } from "ts-pattern";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon } from "../ui/Icons";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import CodeTab from "./CodeTab";
import MetadataInspector from "./MetadataInspector";
import { useRightPanel } from "./useRightPanel";

/** Ordered tab kinds shown in the tab bar. Adding a new kind to the
 *  discriminated union requires a corresponding entry here AND in
 *  `TAB_LABEL` below — both are typed `Record<RightPanelTabKind, …>` and
 *  fail-compile on missing keys. The body renderer further down dispatches
 *  via `match(kind).exhaustive()`, which also fails-compile on a missing
 *  variant — so adding a new kind is a three-place change that the
 *  compiler enforces end-to-end. */
const TAB_KINDS: readonly RightPanelTabKind[] = ["inspector", "code"] as const;

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
   *  (`RightPanelLayout`) decides — desktop reads `collapsed()`, mobile
   *  reads `drawerOpen()`. Threading the signal keeps `RightPanel` a
   *  pure presenter and lets `aria-hidden` track actual visibility on
   *  both surfaces. */
  visible: boolean;
  /** Float as a card (rounded + shadow + inset) rather than sitting
   *  flush with a hard `border-l`. The desktop host derives this from
   *  `useViewPosture().maximized()` — tiled canvas = floating card,
   *  parallel to the Dock's tiled posture (`Dock.tsx:158`). Mobile
   *  always passes `false`: the panel already sits inside a floating
   *  `Drawer.Content`, and an inner card-on-card would double up the
   *  chrome. */
  floating: boolean;
}> = (props) => {
  const rightPanel = useRightPanel();

  const showKind = (kind: RightPanelTabKind) =>
    kind === "inspector" ? rightPanel.showInspector() : rightPanel.showCode();

  return (
    <div
      data-testid="right-panel"
      data-floating={props.floating ? "" : undefined}
      class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0 border-l border-edge"
      classList={{
        // Floating: rounded card + layered shadow + full-perimeter
        // border, on top of the always-on `border-l border-edge` base.
        // Mirrors the Dock's tiled chrome (`Dock.tsx:158`), but adds:
        //   - a two-layer shadow (close + diffuse) so the lift reads
        //     against both the dark canvas (where `shadow-black/40` is
        //     already subtle) and the light canvas (where a soft
        //     shadow washes out against the off-white bg);
        //   - `border border-edge` to define the card perimeter when
        //     the shadow alone isn't enough — gated on `visible` so it
        //     only applies while the panel is expanded.
        //
        // The base `border-l border-edge` stays in both postures —
        // dropping it left the collapsed (parent shrunk to 0)
        // `Resizable.Panel` with a child of *exactly* zero width, and
        // Corvu's `sizes=[1,0]` → user-size re-distribution silently
        // no-ops in that state (it appears to need at least 1px of
        // residual width on the pane to re-grow it). `border` on all
        // sides only activates when `visible`, so the collapsed
        // bounding-rect width stays at 1px (still ≤ the
        // `right-panel.feature` threshold).
        "rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.18),0_16px_32px_-8px_rgba(0,0,0,0.32)]":
          props.floating,
        "border border-edge": props.floating && props.visible,
      }}
      // Panel stays mounted across collapse on desktop so CodeTab's local
      // state survives (#818); RightPanelLayout shrinks it to ~0 width via
      // Resizable `sizes=[1,0]`. `aria-hidden` reflects actual visibility
      // — driven by the host, not the desktop pref, so the contract holds
      // on the mobile drawer host too.
      aria-hidden={!props.visible}
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
      {/* Both tabs are always rendered; the inactive one is display:none.
       *  Mounting both keeps each tab's local state (CodeTab's selected file,
       *  Pierre's tree expansion, scroll position) alive across tab switches
       *  — wrapping a single `match(...).exhaustive()` over `activeTab()`
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
                      themeName={props.themeName}
                      onThemeClick={props.onThemeClick}
                    />
                  ))
                  .with("code", () => (
                    <CodeTab terminalId={props.terminalId} meta={props.meta} />
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
