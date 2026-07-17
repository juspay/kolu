/**
 * The "Restart kaval" button, with an inline confirmation.
 *
 * Restarting kaval is **destructive** — it stops the daemon and every running
 * terminal (the session is captured first and offered for restore on the fresh
 * daemon) — so the primary button opens an inline confirm rather than restarting
 * on the first click (the shared `InlineConfirmButton` shell).
 *
 * Two homes share it — the kaval rail dialog (`tone="neutral"`) and the
 * DegradedCanvas (`tone="danger"`) — so the affordance and the confirm copy
 * can't drift between them. The actual restart is the caller's `onConfirm`: the
 * dialog closes itself first (then restarts); the canvas just restarts.
 *
 * This verb is a total function of the daemon state sum (SK4): it renders only
 * against `dead`/`degraded`/healthy states — an `incompatible` (proven skew)
 * surface offers `UpdateKavalButton` instead, because a restart provably
 * respawns the same incompatible binary.
 */

import type { DaemonStatus } from "@kolu/padi/surface";
import type { Component } from "solid-js";
import { RestartIcon } from "../ui/Icons";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { restartInFlight } from "./useDaemonRestart";

const RestartKavalButton: Component<{
  /** The daemon's status — gates the button out while a restart is in flight. */
  status: DaemonStatus | undefined;
  tone: "neutral" | "danger";
  /** Run when the user confirms. The dialog closes itself here; the canvas
   *  just calls `restartDaemon()`. */
  onConfirm: () => void;
}> = (props) => (
  <InlineConfirmButton
    label="Restart kaval"
    inFlightLabel="Restarting…"
    confirmCopy="Restart kaval? This stops the daemon and every running terminal — your session is captured first and offered for restore on the fresh daemon."
    tone={props.tone}
    inFlight={restartInFlight(props.status)}
    icon={<RestartIcon class="h-3.5 w-3.5" />}
    testid="restart-kaval"
    onConfirm={props.onConfirm}
  />
);

export default RestartKavalButton;
