import Drawer from "@corvu/drawer";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { Component, JSX } from "solid-js";
import { withKeyboardDismiss } from "../ui/dismissSoftKeyboard";
import RightPanel from "./RightPanel";
import { useRightPanel } from "./useRightPanel";

type HostProps = {
  children: JSX.Element;
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  tileId: TerminalId | null;
  themeName?: string;
  onThemeClick?: () => void;
  contentClass?: string;
};

const RightPanelDrawer: Component<HostProps> = (props) => {
  const rightPanel = useRightPanel();

  const onDrawerOpenChange = withKeyboardDismiss(rightPanel.setDrawerOpen);

  return (
    <>
      <div
        class={`flex-1 min-h-0 min-w-0 flex overflow-hidden ${props.contentClass ?? ""}`}
      >
        {props.children}
      </div>
      <Drawer
        side="bottom"
        open={rightPanel.drawerOpen()}
        onOpenChange={onDrawerOpenChange}
        restoreFocus={false}
      >
        <Drawer.Portal forceMount>
          <Drawer.Overlay
            forceMount
            data-testid="right-panel-drawer-backdrop"
            style={{
              "pointer-events": rightPanel.drawerOpen() ? "auto" : "none",
            }}
            class="fixed inset-0 z-40 bg-black/40 opacity-0 transition-opacity duration-200 data-open:opacity-100"
          />
          <Drawer.Content
            forceMount
            inert={!rightPanel.drawerOpen()}
            class="fixed bottom-0 left-0 right-0 z-50 bg-surface-0 border-t border-edge shadow-xl h-[85vh] flex flex-col rounded-t-lg overflow-hidden"
          >
            <div class="flex justify-center py-1.5 shrink-0" aria-hidden="true">
              <span class="w-10 h-1 rounded-full bg-fg-3/40" />
            </div>
            <div class="flex-1 min-h-0 overflow-hidden">
              <RightPanel
                terminalId={props.terminalId}
                meta={props.meta}
                tileId={props.tileId}
                onToggle={() => onDrawerOpenChange(false)}
                themeName={props.themeName}
                onThemeClick={props.onThemeClick}
                visible={rightPanel.drawerOpen()}
              />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  );
};

export default RightPanelDrawer;
