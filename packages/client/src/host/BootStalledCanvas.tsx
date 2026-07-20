/**
 * BootStalledCanvas — the #1763 boot-deadline escape surface.
 *
 * The connect overlay ("Connecting to <host>…") used to spin forever when a boot leg hung
 * (membership / session / daemon), because the only timeout escape was fed by the daemon leg
 * alone. `resolveCanvasMode` now escapes a boot overlay held past its per-host ceiling to a
 * `boot-stalled` mode that NAMES the stalled leg; this component renders it — honest copy from
 * {@link bootStalledCopy} plus, for a wedged remote provision, the live `phase` (copying /
 * building) — over the shared {@link CanvasFailureCard} shell.
 *
 * Recovery verb is **[Reload]** (`location.reload()` — a fresh boot re-runs every leg's
 * subscription from a clean context, the honest "try again" for a hung boot, distinct from
 * HostDownCanvas's `hosts.reconnect` re-dial of a PROVEN-failed binding). **[Switch to local]**
 * is offered when the wedged host is remote — the same escape hatch to the unremovable default.
 *
 * NOTE the local kaval leg never reaches here: a hung LOCAL daemon escapes to the byte-identical
 * `down`/`dead` DegradedCanvas (#1713 preserved), so `leg === "daemon"` here is only a REMOTE
 * daemon stall.
 */

import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import type { Component } from "solid-js";
import type { StalledLeg } from "../kaval/canvasModeResolver";
import { bootStalledCopy } from "../kaval/bootStalledCopy";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
  switchToLocalAction,
} from "./CanvasFailureCard";

const BootStalledCanvas: Component<{
  leg: StalledLeg;
  phase: ConnectPhase | undefined;
}> = (props) => {
  const copy = () => bootStalledCopy(props.leg);
  // Render the live provisioning phase beside the static copy (C4) — so a wedged remote build
  // names WHERE it is stuck ("Still copying" / "Still building") rather than a bare title.
  const detail = () =>
    props.phase === "copying"
      ? "Still copying the recipe to the host…"
      : props.phase === "building"
        ? "Still building on the host…"
        : undefined;
  const actions = (): CanvasFailureAction[] => [
    // A fresh boot re-runs every leg's subscription from a clean context — the honest "try
    // again" for a hung boot (the app has no per-leg re-subscribe from here).
    {
      label: "Reload",
      testid: "boot-stalled-reload",
      tone: "primary",
      onClick: () => location.reload(),
    },
    ...switchToLocalAction(),
  ];
  return (
    <CanvasFailureCard
      dataTestid="boot-stalled-canvas"
      dataAttrs={{ "data-stalled-leg": props.leg }}
      title={copy().title}
      body={copy().body}
      detail={detail()}
      actions={actions()}
    />
  );
};

export default BootStalledCanvas;
