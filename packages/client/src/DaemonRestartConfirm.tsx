/** Confirmation dialog for restarting the local PTY-host daemon.
 *
 *  Opened from the ChromeBar "update pending" nudge or the ⌘K → Debug
 *  "Restart local PTY daemon" command. The daemon survives a kolu-server
 *  restart (so terminals persist across deploys), which means a *newer kolu
 *  build* can't take effect in the daemon until it's restarted — and that
 *  restart necessarily closes the running terminals. So it's always behind an
 *  explicit confirm; the wire-compatible build mismatch is never force-applied
 *  on its own (only a breaking contract change auto-restarts, server-side).
 *
 *  Copy speaks to "a newer kolu build" — the staleness key is the whole kolu
 *  binary's identity (a server-only change bumps it too), not pty-host's code
 *  specifically. */

import Dialog from "@corvu/dialog";
import { type Component, createSignal, Show } from "solid-js";
import { toast } from "solid-sonner";
import { TerminalIcon } from "./ui/Icons";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";
import { client } from "./wire";

const DaemonRestartConfirm: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;
  const [restarting, setRestarting] = createSignal(false);
  const chrome = surface({ portalled: true });

  async function restart(): Promise<void> {
    setRestarting(true);
    const id = toast.loading("Restarting local PTY daemon…");
    try {
      await client.system.restartPtyHostDaemon();
      toast.success("Local PTY daemon restarted — now on the current build", {
        id,
      });
      props.onOpenChange(false);
    } catch (err) {
      toast.error(`Failed to restart PTY daemon: ${(err as Error).message}`, {
        id,
      });
    } finally {
      setRestarting(false);
    }
  }

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      initialFocusEl={cancelRef}
      size="sm"
    >
      <Dialog.Content
        class={`${chrome.class} p-5 text-sm space-y-4`}
        style={chrome.style}
        data-testid="daemon-restart-confirm"
      >
        <Dialog.Label class="font-semibold text-fg">
          Restart local PTY daemon?
        </Dialog.Label>

        <div class="space-y-2 text-fg-2">
          <p>
            A newer kolu build is available. The local terminal daemon is still
            running the previous build — restarting it applies the update.
          </p>
          <p class="text-fg-3">
            <strong class="text-fg-2">
              This will close your running terminals.
            </strong>{" "}
            They run inside the daemon, so they can't carry across the restart.
          </p>
        </div>

        <div class="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            ref={cancelRef}
            class="px-3 py-1.5 text-xs rounded-lg text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
            data-testid="daemon-restart-cancel"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={restarting()}
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-danger text-white hover:brightness-110 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
            data-testid="daemon-restart-confirm-button"
            onClick={() => void restart()}
          >
            <TerminalIcon class="w-3.5 h-3.5 shrink-0" />
            <Show when={restarting()} fallback="Restart daemon">
              Restarting…
            </Show>
          </button>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default DaemonRestartConfirm;
