/** Daemon-restart workflow — singleton module.
 *
 *  Owns the multi-step "restart the surviving pty-host daemon" action that
 *  the rail's `⬆ update pending` and the command palette both trigger: the
 *  loading toast, the `restartPtyHost` RPC, and the branch into either a
 *  success-reload or an error-toast-with-retry. App.tsx stays a thin layout
 *  shell (per solidjs.md) and just wires `restartPtyHost` into the command
 *  deps; commands.tsx stays declarative.
 *
 *  Restart the surviving pty-host daemon to pick up a freshly-deployed build.
 *  The server snapshots + re-saves the session around the restart, so a reload
 *  restores cleanly; a failure leaves the saved session intact (recoverable),
 *  never an empty canvas.
 *
 *  On failure the recovery is a RETRY, not a reload: the daemon lives
 *  server-side, so the degraded handle persists across a browser reload — only
 *  another `restartPtyHost` (which re-reads the pid gate and re-attempts the
 *  respawn) can bring it back. The error toast offers that retry directly. */

import { toast } from "solid-sonner";
import { client } from "./wire";

export function useDaemonRestart() {
  function restartPtyHost() {
    const toastId = toast.loading("Restarting the pty-host daemon…");
    const failed = (detail: string) =>
      toast.error(`Daemon restart failed — your session is saved. ${detail}`, {
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
        action: { label: "Try again", onClick: () => restartPtyHost() },
      });
    void client.server
      .restartPtyHost()
      .then((res) => {
        if (res.ok) {
          toast.success("pty-host daemon restarted — reloading", {
            id: toastId,
          });
          location.reload();
        } else {
          failed("The daemon didn't come back up; retry to try again.");
        }
      })
      .catch((err: Error) => failed(err.message));
  }

  return { restartPtyHost } as const;
}
