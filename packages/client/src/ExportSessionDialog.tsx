/** Export picker for agent transcripts.
 *
 *  The choice happens before generation so the lightweight chat log does not
 *  carry full tool payloads hidden inside the file. */

import Dialog from "@corvu/dialog";
import type { TranscriptHtmlMode } from "kolu-common/transcript";
import type { Component } from "solid-js";
import { useTerminalCrud } from "./terminal/useTerminalCrud";
import { createDisclosure } from "./ui/createDisclosure";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";

export const exportSessionDialog = createDisclosure();

const ExportSessionDialog: Component = () => {
  const crud = useTerminalCrud();
  const chrome = surface({ portalled: true });
  let chatRef: HTMLButtonElement | undefined;

  const exportMode = (modes: TranscriptHtmlMode[]) => {
    exportSessionDialog.close();
    void crud.exportSessionHtml(modes);
  };

  return (
    <ModalDialog
      open={exportSessionDialog.open()}
      onOpenChange={exportSessionDialog.onOpenChange}
      initialFocusEl={chatRef}
      refocusOnClose
      size="sm"
    >
      <Dialog.Content
        class={`${chrome.class} p-5 text-sm space-y-4`}
        style={chrome.style}
        data-testid="export-session-dialog"
      >
        <div class="space-y-1">
          <Dialog.Label class="font-semibold text-fg">
            Export agent session
          </Dialog.Label>
        </div>

        <div class="grid gap-2">
          <button
            type="button"
            ref={chatRef}
            class="text-left rounded-lg border border-edge bg-surface-2 px-3 py-2.5 hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={() => exportMode(["chat"])}
          >
            <span class="block text-fg font-medium">Chat log</span>
            <span class="block text-fg-3 text-xs mt-0.5">
              Small file · You and AI messages
            </span>
          </button>

          <button
            type="button"
            class="text-left rounded-lg border border-edge bg-surface-2 px-3 py-2.5 hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={() => exportMode(["full"])}
          >
            <span class="block text-fg font-medium">Full transcript</span>
            <span class="block text-fg-3 text-xs mt-0.5">
              Tools, results, reasoning, and subtasks collapsed
            </span>
          </button>
        </div>

        <div class="flex flex-wrap justify-between gap-2 pt-1">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-lg text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
            onClick={() => exportSessionDialog.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-lg bg-surface-2 text-fg-2 hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={() => exportMode(["chat", "full"])}
          >
            Export both
          </button>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default ExportSessionDialog;
