/**
 * The `incompatible` (contract-skew) recovery button (SK5). Renders wherever the
 * daemon state is `incompatible` (the skew canvas card and the kaval dialog's
 * incompatible banner), on BOTH local and remote hosts (D1: no host split).
 *
 * The confirmed action is `restartIncompatibleKaval(activeHost())` — the session-preserving
 * kaval RECYCLE (the supervisor stops the old skewed kaval — killing its recorded
 * gate holder — spawns a fresh one from the host's CURRENT closure, and parks the
 * session for restore). An `incompatible` card means padi is HEALTHY and only its
 * kaval is skewed, so a recycle is all that is needed and it comes up the correct
 * version — no whole-padi drain. (If the recycle STILL skews, padi's own closure is
 * genuinely stale and `restartIncompatibleKaval` offers the heavier re-provision as
 * an escalation.)
 */

import type { Component } from "solid-js";
import { RestartIcon } from "../ui/Icons";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { activeHost } from "../wire";
import { recoveryInFlight, restartIncompatibleKaval } from "./useDaemonRestart";

const RestartIncompatibleKavalButton: Component<{
  tone: "neutral" | "danger";
  /** Runs before the confirmed recycle (the dialog closes itself here). */
  onConfirm?: () => void;
}> = (props) => (
  <InlineConfirmButton
    label="Restart kaval"
    inFlightLabel="Restarting…"
    confirmCopy="Restart this host's kaval? This stops the old (incompatible) kaval and starts a correct-version one from the host's current build — the terminals on this host restart and your saved session is offered for restore."
    tone={props.tone}
    inFlight={recoveryInFlight(activeHost())}
    icon={<RestartIcon class="h-3.5 w-3.5" />}
    testid="restart-incompatible-kaval"
    onConfirm={() => {
      props.onConfirm?.();
      // `activeHost()` is correct by the dialog/canvas MOUNT CONVENTION:
      // opening a daemon icon switches the canvas to that host first (see
      // KavalInfoDialog's host-scoping header), and the skew canvas card only
      // ever renders for the active host — so the presented facts and the
      // recycled host agree by construction.
      void restartIncompatibleKaval(activeHost());
    }}
  />
);

export default RestartIncompatibleKavalButton;
