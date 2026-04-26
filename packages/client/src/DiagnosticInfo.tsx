/** Diagnostic Info — runtime state dump for support tickets and
 *  self-diagnosis. Opened from command palette → Debug → Diagnostic
 *  info. */

import Dialog from "@corvu/dialog";
import type { TerminalId } from "kolu-common";
import type { Component } from "solid-js";
import { toast } from "solid-sonner";
import BrowserDiagnosticsSection from "./diagnostics/BrowserDiagnosticsSection";
import ServerDiagnosticsSection from "./diagnostics/ServerDiagnosticsSection";
import { useDiagnosticSnapshot } from "./diagnostics/useDiagnosticSnapshot";
import XtermDiagnosticsSection from "./diagnostics/XtermDiagnosticsSection";
import ModalDialog, { refocusTerminal } from "./ui/ModalDialog";

/** Modal body that owns diagnostic snapshot loading and JSON copy behavior. */
const DiagnosticInfoContent: Component<{
  open: boolean;
  activeId: TerminalId | null;
}> = (props) => {
  const { snapshot, serverDiagnostics } = useDiagnosticSnapshot({
    open: () => props.open,
    activeId: () => props.activeId,
  });

  function copyJson() {
    void navigator.clipboard
      .writeText(JSON.stringify(snapshot(), null, 2))
      .then(() => toast.success("Diagnostic info copied"))
      .catch((err: Error) => toast.error(`Failed to copy: ${err.message}`));
  }

  return (
    <div class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 overflow-hidden flex flex-col max-h-[80vh]">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-edge shrink-0">
        <Dialog.Label class="font-semibold text-fg text-sm">
          Diagnostic info
        </Dialog.Label>
        <button
          type="button"
          data-testid="diagnostic-copy-json"
          onClick={copyJson}
          class="text-[11px] px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-fg-2 hover:text-fg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          Copy JSON
        </button>
      </div>

      <div class="overflow-y-auto">
        <BrowserDiagnosticsSection snapshot={snapshot} />
        <XtermDiagnosticsSection snapshot={snapshot} />
        <ServerDiagnosticsSection serverDiagnostics={serverDiagnostics} />
      </div>
    </div>
  );
};

/** Command-palette diagnostic info modal. */
const DiagnosticInfo: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeId: TerminalId | null;
}> = (props) => (
  <ModalDialog
    open={props.open}
    onOpenChange={(open) => {
      props.onOpenChange(open);
      if (!open) refocusTerminal();
    }}
    size="lg"
  >
    <Dialog.Content>
      <DiagnosticInfoContent open={props.open} activeId={props.activeId} />
    </Dialog.Content>
  </ModalDialog>
);

export default DiagnosticInfo;
