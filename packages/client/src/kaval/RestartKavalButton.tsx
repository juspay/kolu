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

import type { Component } from "solid-js";
import { RestartIcon } from "../ui/Icons";
import InlineConfirmButton from "../ui/InlineConfirmButton";

const RestartKavalButton: Component<{
  /** Whether a restart is already in flight — gates the button out. Computed by the
   *  caller (`restartInFlight`): the dialog has no raw status any more (#1793), and the
   *  canvas already holds one, so each home passes the folded boolean rather than the
   *  button re-reading a status. */
  inFlight: boolean;
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
    inFlight={props.inFlight}
    icon={<RestartIcon class="h-3.5 w-3.5" />}
    testid="restart-kaval"
    onConfirm={props.onConfirm}
  />
);

export default RestartKavalButton;
