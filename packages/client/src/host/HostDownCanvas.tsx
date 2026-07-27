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
 * Takes NO props: this card is unconditionally the ACTIVE host's (App.tsx only ever
 * mounts it from the `host-failed` arm, which is keyed on the active entry — see the
 * module doc above), so it reads its own failed episode off `activeEntryState()`
 * through the shared `failedEpisode` (`kaval/useDaemonStatus.ts`, which owns that
 * rationale) — mirroring `HostDiagnosticsPopover`'s own-component read, rather than
 * having `App.tsx` re-thread the episode down as a prop (`app-shell-stays-thin`: the
 * child reads the domain singleton itself). The copy is looked up by cause, the raw
 * `reason` is shown verbatim as a small detail beneath it, and the tail is shown below
 * that. Before the tail was rendered it was collected, shipped to the browser, and
 * then dropped unread at exactly the moment it mattered: the card showed `'nix build'
 * exited with code 1` and nothing else, sending operators to check ssh for what was a
 * compile error.
 */

import type { Component } from "solid-js";
import { createMemo } from "solid-js";
import { activeEntryState, failedEpisode } from "../kaval/useDaemonStatus";
import DocLink from "../ui/DocLink";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
  reconnectAction,
  switchToLocalAction,
} from "./CanvasFailureCard";
import { hostDownCopy } from "./hostDownCopy";

const HostDownCanvas: Component = () => {
  // The failed episode as ONE value, through the ONE reader every failure surface shares
  // (`failedEpisode`). A MEMO so the several reads below (`cause`/`reason`/`log`, each its
  // own JSX binding) share ONE fold of the map entry rather than three. Safe to be eager
  // here (unlike a hoisted-to-App.tsx memo would be): this whole component only ever
  // mounts from the `host-failed` <Match> arm, so its body — and this memo's creation —
  // never runs while the active entry is anything other than `failed`. Unrepresentable
  // otherwise — fail loud, same as `App.tsx`'s `requireKind`.
  const failure = createMemo(() => {
    const episode = failedEpisode(activeEntryState());
    if (episode === undefined) {
      throw new Error(`HostDownCanvas: entry is ${activeEntryState().kind}`);
    }
    return episode;
  });
  const copy = () => hostDownCopy(failure().cause);
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
      dataAttrs={{ "data-entry-cause": failure().cause }}
      title={copy().title}
      body={copy().body}
      detail={failure().reason}
      log={failure().log}
      logTestid="host-down-log"
      footer={<DocLink slug="remote-hosts">Learn more →</DocLink>}
      actions={actions()}
    />
  );
};

export default HostDownCanvas;
