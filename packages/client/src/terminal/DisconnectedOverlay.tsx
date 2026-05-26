/**
 * DisconnectedOverlay — covers a remote terminal tile when the SSH
 * connection has dropped.
 *
 * Triggered by `terminal.connectionState === "disconnected"` — the
 * channel that `HostSession`'s state machine drives via
 * `RemoteBackend.terminalChannel(id, "connectionState")`. Mirrors
 * Zed's `disconnected_overlay.rs:17-214` for the kolu aesthetic.
 *
 * Shows:
 *  - Host name
 *  - Reason (heartbeat lost / reconnect attempts exhausted / server
 *    not running on remote)
 *  - Reconnect button — re-runs the HostSession's connect cycle
 *  - Close-tile button — kills the terminal entirely
 *
 * Prototype scope: visual + button stubs (handlers wired in R-3 when
 * HostSession's connect/dispose cycle is real).
 */

import { Show } from "solid-js";
import type { ConnectionState, TerminalLocation } from "kolu-common/surface";

export function DisconnectedOverlay(props: {
  location: TerminalLocation;
  connectionState: ConnectionState;
  onReconnect: () => void;
  onClose: () => void;
}) {
  const visible = () =>
    props.location.kind === "ssh" && props.connectionState === "disconnected";
  const reconnecting = () =>
    props.location.kind === "ssh" && props.connectionState === "connecting";
  return (
    <Show when={visible() || reconnecting()}>
      <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60 text-white backdrop-blur-sm">
        <div class="text-sm font-mono opacity-70">
          {props.location.kind === "ssh" ? props.location.host : ""}
        </div>
        <div class="text-base font-semibold">
          {reconnecting() ? "Reconnecting…" : "Disconnected"}
        </div>
        <Show when={!reconnecting()}>
          <div class="flex gap-2 mt-2">
            <button
              type="button"
              class="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-sm"
              onClick={props.onReconnect}
            >
              Reconnect
            </button>
            <button
              type="button"
              class="px-3 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
              onClick={props.onClose}
            >
              Close tile
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
