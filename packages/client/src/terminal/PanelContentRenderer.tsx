/** PanelContentRenderer — dispatches a `PanelContent` to the right
 *  component. The host (`PanelHost`) calls this for the active tab; one
 *  renderer per kind, no nested route table. */

import { type Component } from "solid-js";
import { match } from "ts-pattern";
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
  return match(props.content)
    .with({ kind: "inspector" }, () => (
      <MetadataInspector
        meta={props.meta}
        themeName={props.themeName}
        onThemeClick={props.onThemeClick}
      />
    ))
    .with({ kind: "code" }, (c) => (
      <CodeTab
        meta={props.meta}
        mode={c.mode}
        onModeChange={props.onCodeModeChange}
      />
    ))
    .with({ kind: "terminal" }, (c) => (
      <Terminal
        terminalId={c.id}
        visible={props.visible && props.focused}
        focused={props.focused}
        theme={props.theme}
        searchOpen={false}
        onSearchOpenChange={() => {}}
        onFocus={props.onFocus}
        isSub
      />
    ))
    .with({ kind: "browser" }, (c) => (
      <iframe
        title={`Browser: ${c.url}`}
        src={c.url}
        class="w-full h-full border-0 bg-surface-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    ))
    .exhaustive();
};

export default PanelContentRenderer;
