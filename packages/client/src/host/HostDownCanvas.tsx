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
 *
 * `log` is the failing episode's retained output tail, and it does NOT ride the
 * CanvasMode: the mode is a ROUTING decision that already recomputes on every
 * monotonic tick, so folding a per-line-churning array into it would mint a fresh
 * mode object per log line. It comes straight off the same fine `connection`
 * payload `ConnectCanvas` narrates from — which the session deliberately carries
 * FORWARD into the `failed` arm (`setDown`'s `log: prev.log`) precisely so the
 * lines stay readable after the give-up. Before this it was collected, shipped to
 * the browser, and then dropped unread at exactly the moment it mattered: the card
 * showed `'nix build' exited with code 1` and nothing else, sending operators to
 * check ssh for what was a compile error.
 */

import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import type { Component } from "solid-js";
import DocLink from "../ui/DocLink";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
  reconnectAction,
  switchToLocalAction,
} from "./CanvasFailureCard";
import { hostDownCopy } from "./hostDownCopy";

const HostDownCanvas: Component<{
  cause: EntryFailedCause;
  reason: string;
  /** The failed episode's retained output tail (oldest first). Empty for a cause that
   *  never produced any — the card then renders exactly as before. */
  log: readonly { readonly line: string }[];
}> = (props) => {
  const copy = () => hostDownCopy(props.cause);
  const actions = (): CanvasFailureAction[] => [
    // The RECOVERY verb. A standing refuse (cross-supervisor / skew / unconverged)
    // HOLDS degraded WITHOUT auto-reconnecting — so once the operator clears the cause
    // named above, THIS is the path back: `hosts.reconnect` force-cycles the held
    // session (recheck()) into a fresh dial. NOT the inert-retry we forbade — the failed
    // arm never auto-retries, so this genuinely re-dials.
    reconnectAction({ label: "Reconnect", testid: "host-reconnect" }),
    ...switchToLocalAction(),
  ];
  return (
    <CanvasFailureCard
      dataTestid="host-down-canvas"
      dataAttrs={{ "data-entry-cause": props.cause }}
      title={copy().title}
      body={copy().body}
      detail={props.reason}
      log={props.log}
      footer={<DocLink slug="remote-hosts">Learn more →</DocLink>}
      actions={actions()}
    />
  );
};

export default HostDownCanvas;
