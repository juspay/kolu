/**
 * BootStalledCanvas — the #1763 boot-deadline escape surface, now HONEST about who owns the
 * wedged leg (#1908 D2). The resolver decides the {@link BootStalledRecovery} verdict in
 * `escapeSurface`; this component just renders it, so the recovery is never re-derived here.
 *
 * Two shapes, one per recovery arm:
 *   - `via: "connector"` — a warming REMOTE campaign the server ssh connector is STILL retrying
 *     (probing / copying / building / connecting). NON-TERMINAL copy from {@link CONNECTOR_STALLED_COPY}
 *     plus the live `phase` detail, and the recovery verb **[Retry connection]** calls
 *     `client.hosts.reconnect` — which PR1 gave a real abort-in-flight `recheck()` that recycles
 *     the held server session into a fresh dial. `location.reload()` could not recycle a
 *     server-side connector, so it would be a lie over a still-retrying campaign (the field
 *     bewilderment this fixes: the old card read as a terminal wedge over a self-healing dial).
 *   - `via: "client"` — a genuinely client-side leg (a connected host's session/daemon
 *     subscription, or a membership stall). Its own {@link bootStalledCopy} plus the **[Reload]**
 *     verb (`location.reload()` — a fresh boot re-runs every leg's subscription from a clean
 *     context, the honest "try again" for a hung client-side boot).
 *
 * **[Switch to local]** is offered on either shape when the wedged host is remote — the escape
 * hatch to the unremovable default. A hung LOCAL kaval never reaches here (it takes the
 * byte-identical down/dead DegradedCanvas — #1713 preserved — via the resolver's down arm).
 */

import type { Component } from "solid-js";
import type { BootStalledRecovery } from "../kaval/canvasModeResolver";
import {
  type BootStalledCopy,
  bootStalledCopy,
  bootStalledPhaseDetail,
  CONNECTOR_STALLED_COPY,
} from "../kaval/bootStalledCopy";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
  reconnectAction,
  switchToLocalAction,
} from "./CanvasFailureCard";

/** The card's rendered view for a resolved recovery arm — copy, the live phase detail
 *  (connector arm only), the outer data attributes, and the primary recovery verb. */
interface BootStalledView {
  copy: BootStalledCopy;
  detail: string | undefined;
  dataAttrs: Record<string, string>;
  recovery: CanvasFailureAction;
}

const BootStalledCanvas: Component<{ recovery: BootStalledRecovery }> = (
  props,
) => {
  // Narrow the recovery ONCE per read (a discriminated union), then build the card's copy,
  // phase detail, data attributes, and primary recovery verb off the narrowed arm — so neither
  // the connector's `phase` nor the client's `leg` is ever read on the wrong arm.
  const view = (): BootStalledView => {
    const r = props.recovery;
    if (r.via === "connector") {
      return {
        copy: CONNECTOR_STALLED_COPY,
        detail: bootStalledPhaseDetail(r.phase),
        dataAttrs: { "data-recovery": "connector" },
        // The RECOVERY verb: recycle the SERVER connector for this host (PR1's recheck()),
        // NOT `location.reload()` (which recycles only the browser and can't touch the dial).
        recovery: reconnectAction({
          label: "Retry connection",
          testid: "boot-stalled-reconnect",
        }),
      };
    }
    return {
      copy: bootStalledCopy(r.leg),
      detail: undefined,
      dataAttrs: { "data-recovery": "client", "data-stalled-leg": r.leg },
      // A fresh boot re-runs every leg's subscription from a clean context — the honest "try
      // again" for a hung client-side boot (the app has no per-leg re-subscribe from here).
      recovery: {
        label: "Reload",
        testid: "boot-stalled-reload",
        tone: "primary" as const,
        onClick: () => location.reload(),
      },
    };
  };
  const actions = (): CanvasFailureAction[] => [
    view().recovery,
    ...switchToLocalAction(),
  ];
  return (
    <CanvasFailureCard
      dataTestid="boot-stalled-canvas"
      dataAttrs={view().dataAttrs}
      title={view().copy.title}
      body={view().copy.body}
      detail={view().detail}
      actions={actions()}
    />
  );
};

export default BootStalledCanvas;
