/** Confirmation for restarting the kolu daemon (the surviving terminal host).
 *
 *  The restart is destructive — it ends every running shell and agent — so
 *  both entry points (the rail's `⬆ update pending` badge and the command
 *  palette) route through this one dialog. State lives in the
 *  `useDaemonRestart` singleton; this component is mounted once in App.tsx and
 *  driven by `confirmOpen` / `cancelRestart` / `confirmRestart`. */

import Dialog from "@corvu/dialog";
import type { Component } from "solid-js";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";

const DaemonUpdateConfirm: Component<{
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;
  const chrome = surface({ portalled: true });
  return (
    <ModalDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      initialFocusEl={cancelRef}
      size="sm"
    >
      <Dialog.Content
        class={`${chrome.class} p-5 text-sm space-y-4`}
        style={chrome.style}
        data-testid="daemon-update-confirm"
      >
        <Dialog.Label class="font-semibold text-fg">
          Restart the kolu daemon?
        </Dialog.Label>

        <div class="space-y-2 text-fg-2">
          <p>
            Your terminals survived recent deploys, so the kolu daemon is still
            running the code it shipped with — and a newer build is now
            deployed. Restart to adopt it.{" "}
            <b class="text-fg-2">It's optional</b> — the current daemon keeps
            working until you do.
          </p>
          <p class="text-fg-3">
            Restarting{" "}
            <b class="text-fg-2">ends every running shell and agent.</b> Your
            session is snapshotted and restores — same repos, branches and
            layout — as fresh shells (scrollback resets); agents that support it
            relaunch with their <code class="text-fg-2">--continue</code> flag.
          </p>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            data-testid="daemon-update-cancel"
            class="px-3 py-1.5 text-xs rounded-lg text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
            onClick={() => props.onCancel()}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="daemon-update-restart"
            class="px-3 py-1.5 text-xs rounded-lg bg-warning text-white hover:brightness-110 transition-colors cursor-pointer"
            onClick={() => props.onConfirm()}
          >
            Restart daemon
          </button>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default DaemonUpdateConfirm;
