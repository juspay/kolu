/** Daemon-restart workflow — singleton module.
 *
 *  Owns the multi-step "restart the kolu daemon" action that
 *  the rail's `⬆ update pending` badge and the command palette both trigger.
 *  Because the restart is **destructive** (it ends every running shell and
 *  agent — they re-spawn from the saved session as fresh shells), both entry
 *  points go through `requestRestart()` → a single confirmation dialog
 *  (`DaemonUpdateConfirm`, mounted once in App.tsx) → `confirmRestart()`. The
 *  confirm-open state is module-level (the singleton pattern) so the badge and
 *  the command share one dialog. `restartPtyHost()` is the actual action: the
 *  loading toast, the `restartPtyHost` RPC, and the branch into either a
 *  success-reload or an error-toast-with-retry. App.tsx stays a thin layout
 *  shell (per solidjs.md) and just wires `requestRestart` into the command
 *  deps; commands.tsx stays declarative.
 *
 *  Restart the kolu daemon to pick up a freshly-deployed build.
 *  The server snapshots + re-saves the session around the restart, so a reload
 *  restores cleanly; a failure leaves the saved session intact (recoverable),
 *  never an empty canvas.
 *
 *  On failure the recovery is a RETRY, not a reload: the daemon lives
 *  server-side, so the degraded handle persists across a browser reload — only
 *  another `restartPtyHost` (which re-reads the pid gate and re-attempts the
 *  respawn) can bring it back. The error toast offers that retry directly. */

import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "./wire";

// Module-level (singleton) so the rail badge and the palette command open the
// SAME confirmation dialog rather than each owning a copy.
const [confirmOpen, setConfirmOpen] = createSignal(false);

export function useDaemonRestart() {
  function restartPtyHost() {
    const toastId = toast.loading("Restarting the kolu daemon…");
    const failed = (detail: string) =>
      toast.error(
        `kolu daemon restart failed — your session is saved. ${detail}`,
        {
          id: toastId,
          duration: Number.POSITIVE_INFINITY,
          action: { label: "Try again", onClick: () => restartPtyHost() },
        },
      );
    void client.server
      .restartPtyHost()
      .then((res) => {
        if (res.ok) {
          toast.success("kolu daemon restarted — reloading", {
            id: toastId,
          });
          location.reload();
        } else {
          failed("The daemon didn't come back up; retry to try again.");
        }
      })
      .catch((err: Error) => failed(err.message));
  }

  /** Open the confirmation. The destructive restart fires only on confirm. */
  const requestRestart = () => setConfirmOpen(true);
  const cancelRestart = () => setConfirmOpen(false);
  const confirmRestart = () => {
    setConfirmOpen(false);
    restartPtyHost();
  };

  return {
    restartPtyHost,
    requestRestart,
    cancelRestart,
    confirmRestart,
    confirmOpen,
  } as const;
}
