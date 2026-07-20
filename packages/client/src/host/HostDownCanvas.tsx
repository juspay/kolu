/**
 * HostDownCanvas — the Skew-UX "this host's padi failed to bind" surface.
 *
 * Distinct from `DegradedCanvas` (a CONNECTED host whose kaval daemon died, which
 * offers a Restart): this is the ACTIVE host's map-membership entry itself failing
 * — an ssh/contract-level fault the map reports as a TYPED {@link EntryFailedCause}.
 *
 * Two actions: **[Reconnect]** (the recovery verb — `hosts.reconnect` force-cycles
 * the held session into a fresh dial; a STANDING refuse holds degraded WITHOUT
 * auto-reconnecting, so once the operator clears the cause named in the copy, this
 * is the path back — it is a REAL re-dial, not the inert Retry we forbid on a
 * transient arm that already auto-retries) and **[Switch to local]** (the escape
 * hatch to the unremovable default). Each cause gets first-class plain-language copy
 * from the pure {@link hostDownCopy} map; this component wires that copy + the two
 * buttons into the shared {@link CanvasFailureCard} shell.
 *
 * `cause` + `reason` arrive as props from the resolved `host-failed` CanvasMode
 * (App.tsx reads them off the active entry's `state()`); the copy is looked up by
 * cause and the raw `reason` is shown verbatim as a small detail beneath it.
 */

import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import type { Component } from "solid-js";
import { toast } from "solid-sonner";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
} from "./CanvasFailureCard";
import { activeHost, client, setActiveHost } from "../wire";
import { hostDownCopy } from "./hostDownCopy";

const HostDownCanvas: Component<{
  cause: EntryFailedCause;
  reason: string;
}> = (props) => {
  const copy = () => hostDownCopy(props.cause);
  // The local default is unremovable and always a member, so `[Switch to local]`
  // is the always-available escape hatch — hidden only when it IS the active host
  // (switching to where you already are is a no-op).
  const isLocal = () => activeHost().kind === "local";
  const actions = (): CanvasFailureAction[] => [
    // The RECOVERY verb. A standing refuse (cross-supervisor / skew / unconverged)
    // HOLDS degraded WITHOUT auto-reconnecting — so once the operator clears the cause
    // named above, THIS is the path back: `hosts.reconnect` force-cycles the held
    // session (recheck()) into a fresh dial. NOT the inert-retry we forbade — the failed
    // arm never auto-retries, so this genuinely re-dials.
    {
      label: "Reconnect",
      testid: "host-reconnect",
      tone: "primary",
      onClick: () => {
        client.hosts
          .reconnect({ host: activeHost() })
          .catch((err: Error) =>
            toast.error(`Couldn't reconnect: ${err.message}`),
          );
      },
    },
    ...(isLocal()
      ? []
      : [
          {
            label: "Switch to local",
            testid: "switch-to-local",
            tone: "secondary" as const,
            onClick: () => setActiveHost(LOCAL_HOST),
          },
        ]),
  ];
  return (
    <CanvasFailureCard
      dataTestid="host-down-canvas"
      dataAttrs={{ "data-entry-cause": props.cause }}
      title={copy().title}
      body={copy().body}
      detail={props.reason}
      actions={actions()}
    />
  );
};

export default HostDownCanvas;
