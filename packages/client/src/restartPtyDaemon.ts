/** Trigger a restart of the local PTY-host daemon — the action behind the
 *  chrome-bar "update pending" nudge. The server kills the running daemon
 *  and spawns a fresh one, which drops every live terminal, so this is
 *  user-initiated only (a command, never automatic). */

import { toast } from "solid-sonner";
import { client } from "./wire";

export async function restartPtyDaemon(): Promise<void> {
  const id = toast.loading("Restarting local PTY daemon…");
  try {
    await client.server.restartPtyDaemon();
    toast.success("Local PTY daemon restarted", { id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Failed to restart PTY daemon: ${message}`, { id });
  }
}
