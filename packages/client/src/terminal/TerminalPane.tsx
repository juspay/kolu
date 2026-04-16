/** TerminalPane — focus mode wrapper: shows one terminal at a time.
 *  Hides via CSS when not active. Delegates rendering to TerminalContent. */

import { type Component } from "solid-js";
import type { ITheme } from "@xterm/xterm";
import TerminalContent from "./TerminalContent";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const TerminalPane: Component<{
  terminalId: TerminalId;
  visible: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: TerminalId[];
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  onCloseTerminal: (id: TerminalId) => void;
  activeMeta: TerminalMetadata | null;
}> = (props) => {
  return (
    <div
      class="w-full h-full relative flex flex-col"
      classList={{ hidden: !props.visible }}
    >
      <TerminalContent
        terminalId={props.terminalId}
        visible={props.visible}
        focused={props.visible}
        theme={props.theme}
        searchOpen={props.searchOpen}
        onSearchOpenChange={props.onSearchOpenChange}
        subTerminalIds={props.subTerminalIds}
        getMetadata={props.getMetadata}
        onCreateSubTerminal={props.onCreateSubTerminal}
        onCloseTerminal={props.onCloseTerminal}
        activeMeta={props.activeMeta}
      />
    </div>
  );
};

export default TerminalPane;
