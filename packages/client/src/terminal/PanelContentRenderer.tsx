/** PanelContentRenderer — dispatches a `PanelContent` to the right
 *  component. The host (`PanelHost`) calls this for the active tab; one
 *  renderer per kind, no nested route table. */

import { type Component, Match, Switch } from "solid-js";
import type { ITheme } from "@xterm/xterm";
import type {
  CodeTabView,
  PanelContent,
  TerminalId,
  TerminalMetadata,
} from "kolu-common";
import Terminal from "./Terminal";
import MetadataInspector from "../right-panel/MetadataInspector";
import CodeTab from "../right-panel/CodeTab";

const PanelContentRenderer: Component<{
  /** The tile this slot belongs to — used as the metadata source for
   *  Inspector / Code, and as the parent for terminal-kind tabs. */
  hostTerminalId: TerminalId;
  /** The content to render. */
  content: PanelContent;
  /** Whether the parent slot is the keyboard-focus target right now —
   *  passed through to embedded terminals so xterm grabs focus. */
  focused: boolean;
  /** Whether the parent tile is visible — passed through to embedded
   *  terminals so off-screen WebGL contexts stay torn down. */
  visible: boolean;
  /** Tile theme — applied to embedded terminals so they read against the
   *  same background as the host. */
  theme: ITheme;
  /** Tile theme name — passed to Inspector for the "Theme" row. */
  themeName?: string;
  /** Inspector "Theme" row click → opens command palette. */
  onThemeClick?: () => void;
  /** Metadata of the host terminal — Inspector and Code both render this
   *  tile's repo/branch/PR/agent state. */
  meta: TerminalMetadata | null;
  /** Code-tab mode — threaded through so the active sub-view (local /
   *  branch / browse) round-trips through the panel content variant. */
  onCodeModeChange: (mode: CodeTabView) => void;
  /** Fired when the user clicks/types into an embedded terminal. */
  onFocus?: () => void;
}> = (props) => {
  // `<Switch>`/`<Match>` (reactive) over ts-pattern `match()` (one-shot at
  // mount): when the active tab swaps to a different kind, the component
  // re-uses props.content's accessor — a non-reactive `match()` would mount
  // the first kind and never swap, leaving (e.g.) the Inspector visible
  // after the user clicked a sibling sub-terminal tab. Each branch is a
  // narrow accessor so the embedded `<Terminal>` / `<iframe>` re-mount only
  // when their own discriminator fields change.
  const kind = () => props.content.kind;
  return (
    <Switch>
      <Match when={kind() === "inspector"}>
        <MetadataInspector
          meta={props.meta}
          themeName={props.themeName}
          onThemeClick={props.onThemeClick}
        />
      </Match>
      <Match
        when={
          kind() === "code" && (props.content as { mode: CodeTabView }).mode
        }
      >
        {(mode) => (
          <CodeTab
            meta={props.meta}
            mode={mode()}
            onModeChange={props.onCodeModeChange}
          />
        )}
      </Match>
      <Match
        when={kind() === "terminal" && (props.content as { id: TerminalId }).id}
      >
        {(id) => (
          <Terminal
            terminalId={id()}
            // Visibility tracks the host tile only — coupling to `focused`
            // keeps the xterm `display:none` until the user explicitly
            // focuses the slot, which makes a freshly-clicked tab render
            // 0×0 and look "empty". Keyboard focus stays gated on
            // `focused` so the active edge still owns input.
            visible={props.visible}
            focused={props.focused}
            theme={props.theme}
            searchOpen={false}
            onSearchOpenChange={() => {}}
            onFocus={props.onFocus}
            isSub
          />
        )}
      </Match>
      <Match
        when={kind() === "browser" && (props.content as { url: string }).url}
      >
        {(url) => (
          <iframe
            title={`Browser: ${url()}`}
            src={url()}
            class="w-full h-full border-0 bg-surface-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </Match>
    </Switch>
  );
};

export default PanelContentRenderer;
