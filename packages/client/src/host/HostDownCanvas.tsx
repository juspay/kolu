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
 * The whole failed episode arrives as ONE `failure` prop — cause, reason, and the
 * retained output tail are three fields of one entry status, read together at the
 * render arm (see App.tsx's `hostFailure`, which owns that rationale). The copy is
 * looked up by cause, the raw `reason` is shown verbatim as a small detail beneath
 * it, and the tail is shown below that. Before the tail was rendered it was
 * collected, shipped to the browser, and then dropped unread at exactly the moment
 * it mattered: the card showed `'nix build' exited with code 1` and nothing else,
 * sending operators to check ssh for what was a compile error.
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
  /** The failed episode, as ONE value read once at the arm (App.tsx's `hostFailure`).
   *  `log` is its retained output tail, oldest first — `undefined` when the map's
   *  liveness floor dropped the connection word (we cannot see the output), empty for a
   *  cause that never produced any. Both render no tail block; only the first is a
   *  claim the card must not make. */
  failure: {
    readonly cause: EntryFailedCause;
    readonly reason: string;
    readonly log: readonly { readonly line: string }[] | undefined;
  };
}> = (props) => {
  const copy = () => hostDownCopy(props.failure.cause);
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
      dataAttrs={{ "data-entry-cause": props.failure.cause }}
      title={copy().title}
      body={copy().body}
      detail={props.failure.reason}
      log={props.failure.log}
      logTestid="host-down-log"
      footer={<DocLink slug="remote-hosts">Learn more →</DocLink>}
      actions={actions()}
    />
  );
};

export default HostDownCanvas;
