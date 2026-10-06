/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs via the DU view exposed by
 *  `useRightPanel().activeTab()`.
 *
 *  The panel's SUBJECT is the focused pane (`props.terminalId`/`props.meta` — a
 *  top-level tile's main pane, or any split at any nesting depth), while its
 *  OPEN/CLOSED posture belongs to the containing tile (`props.tileId`). A pane
 *  HEADER line under the tab bar — shared by both tabs, so it never shifts
 *  between them — names the directory this pane (and so the Code tree) is rooted
 *  at, and prefixes the split's own name when the shown pane is a split.
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

import { PanelShown } from "./panelShown";

import type {
  RightPanelTabKind,
  TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { match } from "ts-pattern";
import { dockRowLabel } from "../canvas/dock/dockRowData";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon } from "../ui/Icons";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import CodeTab from "./CodeTab";
import MetadataInspector from "./MetadataInspector";
import { paneDirectory } from "./paneDirectory";
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
  /** The pane the panel SHOWS — a tile's main terminal, or a split at any depth. */
  terminalId: TerminalId | null;
  /** `terminalId`'s own metadata (glitch-free pairing — see `store.focused()`). */
  meta: TerminalMetadata | null;
  /** The containing top-level tile, which owns the panel's open/closed posture
   *  and the tile-wide sections (Ports, Attach). Equals `terminalId` when the
   *  shown pane is the tile's main terminal. */
  tileId: TerminalId | null;
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

  /** The split's own name, shown only when the panel is NOT on the tile's main
   *  pane. Reuses `dockRowLabel` — the ONE author of a dock row's annotation
   *  words, and already what a split's dock sub-row shows — so the panel and the
   *  dock can never name the same split two different ways. */
  const paneLabel = (): string | null => {
    const meta = props.meta;
    if (!meta) return null;
    if (props.terminalId === null || props.terminalId === props.tileId)
      return null;
    return dockRowLabel(meta, undefined);
  };

  /** The pane's directory, split at the repo root the Code tree is browsed from
   *  — `~`-shortened by the ONE shortener, so the root keeps the emphasis and
   *  everything below it dims. The split itself lives in `paneDirectory`, with
   *  its own test. */
  const directory = () => paneDirectory(props.meta);

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
                data-active={isActive() ? "" : undefined}
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
      {/* Pane header — which pane this is and where it lives. ONE line above the
       *  tab bodies, so both tabs share it and switching tabs never shifts it.
       *  The split's name (when the shown pane is a split) prefixes the
       *  directory the pane — and so the Code tree — is rooted at. */}
      <Show when={directory()}>
        {(dir) => (
          <div class="flex items-center gap-1.5 h-6 shrink-0 px-3 bg-surface-1/40 border-b border-edge font-mono text-[10px]">
            <Show when={paneLabel()}>
              {(label) => (
                <span
                  data-testid="right-panel-pane-label"
                  title={`Showing the "${label()}" split`}
                  class="shrink-0 max-w-[12ch] truncate text-fg-3/60"
                >
                  {label()}
                </span>
              )}
            </Show>
            {/* Truncate from the LEFT: `direction: rtl` clips the line's start,
             *  and the `bdi` keeps the path itself LTR so its `~` and `/` are
             *  not re-ordered by the bidi algorithm. The full path is in the
             *  title. */}
            <span
              data-testid="right-panel-directory"
              title={dir().full}
              class="min-w-0 flex-1 truncate text-left"
              style={{ direction: "rtl" }}
            >
              <bdi>
                <span class="font-semibold text-fg-2">{dir().root}</span>
                <span class="opacity-60">{dir().rest}</span>
              </bdi>
            </span>
          </div>
        )}
      </Show>
      {/* Both tabs are always rendered; the inactive one is display:none.
       *  Mounting both keeps each tab's local state (CodeTab's selected file,
       *  Pierre's tree expansion, scroll position) alive across tab switches
       *  — wrapping a single `match(...).exhaustive()` over `activeTab()`
       *  would unmount the inactive sibling and discard that state. The
       *  shape below iterates `TAB_KINDS` (already compile-exhaustive over
       *  RightPanelTabKind via the `Record<RightPanelTabKind, …>` typings
       *  on TAB_LABEL) so both bodies mount once, then `match(kind)` picks
       *  which component to render per slot — exhaustive *and* both-mounted. */}
      <div class="relative flex-1 min-h-0 overflow-hidden">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <div
                class="h-full w-full"
                style={{
                  position: isActive() ? "relative" : "absolute",
                  inset: "0",
                  "content-visibility": isActive() ? "visible" : "hidden",
                }}
                inert={!isActive()}
                aria-hidden={!isActive()}
              >
                <PanelShown.Provider value={() => props.visible && isActive()}>
                  {match(kind)
                    .with("inspector", () => (
                      <MetadataInspector
                        meta={props.meta}
                        terminalId={props.terminalId}
                        tileId={props.tileId}
                        themeName={props.themeName}
                        onThemeClick={props.onThemeClick}
                      />
                    ))
                    .with("code", () => (
                      <CodeTab
                        terminalId={props.terminalId}
                        meta={props.meta}
                      />
                    ))
                    .exhaustive()}
                </PanelShown.Provider>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};

export default RightPanel;
