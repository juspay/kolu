/**
 * The "Update &amp; restart kaval" button — the CONTRACT-SKEW recovery verb
 * (SK5). Renders wherever the daemon state is `incompatible` (the skew canvas
 * card and the kaval dialog's incompatible banner), on BOTH local and remote
 * hosts (D1: no host split — by `incompatible`'s construction a respawn from
 * the host's current closure has already been tried and skewed, so the only
 * action offered is the one that changes the closure).
 *
 * Destructive (drains the host's padi; its terminals restart on the fresh
 * stack), so it rides the same inline-confirm shell as Restart kaval. The
 * confirmed action is `renewDaemon(activeHost())` — the binder-owned drain →
 * re-realise → fresh correct-version kaval pipeline.
 */

import type { Component } from "solid-js";
import { RestartIcon } from "../ui/Icons";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { activeHost } from "../wire";
import { renewDaemon, renewInFlight } from "./useDaemonRestart";

const UpdateKavalButton: Component<{
  tone: "neutral" | "danger";
  /** Runs before the confirmed renew (the dialog closes itself here). */
  onConfirm?: () => void;
}> = (props) => (
  <InlineConfirmButton
    label="Update & restart kaval"
    inFlightLabel="Updating…"
    confirmCopy="Update & restart this host's kaval? This drains the host daemon, re-provisions the current build on the host, and starts a correct-version kaval — the terminals on this host restart."
    tone={props.tone}
    inFlight={renewInFlight(activeHost())}
    icon={<RestartIcon class="h-3.5 w-3.5" />}
    testid="update-kaval"
    onConfirm={() => {
      props.onConfirm?.();
      // `activeHost()` is correct by the dialog/canvas MOUNT CONVENTION:
      // opening a daemon icon switches the canvas to that host first (see
      // KavalInfoDialog's host-scoping header), and the skew canvas card only
      // ever renders for the active host — so the presented facts and the
      // renewed host agree by construction.
      void renewDaemon(activeHost());
    }}
  />
);

export default UpdateKavalButton;
