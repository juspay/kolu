/**
 * BootStalledCanvas — the #1763 boot-deadline escape surface, now HONEST about who owns the
 * wedged leg (#1908 D2). The resolver decides the {@link BootStalledRecovery} verdict in
 * `escapeSurface`; this component just renders it, so the recovery is never re-derived here.
 *
 * Two shapes, one per recovery arm:
 *   - `via: "connector"` — a warming REMOTE campaign the server ssh connector is STILL retrying
 *     (probing / provisioning / connecting). NON-TERMINAL copy from {@link CONNECTOR_STALLED_COPY}
 *     plus the live `phase` detail and that campaign's output tail, and the recovery verb
 *     **[Retry connection]** calls
 *     `client.hosts.reconnect` — which PR1 gave a real abort-in-flight `recheck()` that recycles
 *     the held server session into a fresh dial. `location.reload()` could not recycle a
 *     server-side connector, so it would be a lie over a still-retrying campaign (the field
 *     bewilderment this fixes: the old card read as a terminal wedge over a self-healing dial).
 *   - `via: "client"` — a genuinely client-side leg (a connected host's session/daemon
 *     subscription, or a membership stall). No tail: this arm carries none, so the settled
 *     connect log that has nothing to say about the wedge is unspellable here rather than
 *     suppressed by a ternary. Its own {@link bootStalledCopy} plus the **[Reload]** verb (`location.reload()` — a fresh boot re-runs every leg's subscription from a clean
 *     context, the honest "try again" for a hung client-side boot).
 *
 * **[Switch to local]** is offered on either shape when the wedged host is remote — the escape
 * hatch to the unremovable default. A hung LOCAL kaval never reaches here (it takes the
 * byte-identical down/dead DegradedCanvas — #1713 preserved — via the resolver's down arm).
 *
 * REACTIVITY (#1908 D2, codex F2): `canvasMode` returns a FRESH `recovery` object every ~1s
 * monotonic re-resolve, so both recovery verbs are built ONCE per instance and selected through a
 * PRIMITIVE `via` memo (deduped on value). That keeps each action object's identity stable across
 * ticks, so `CanvasFailureCard`'s identity-keyed `<For>` never tears down and recreates a button —
 * a keyboard user focused on Retry connection / Switch to local keeps focus. Copy + phase detail
 * are derived separately, so a phase change narrates without churning the buttons.
 */

import { type Component, createMemo } from "solid-js";
import {
  bootStalledCopy,
  bootStalledPhaseDetail,
  CONNECTOR_STALLED_COPY,
} from "../kaval/bootStalledCopy";
import type { BootStalledRecovery } from "../kaval/canvasModeResolver";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
  reconnectAction,
  switchToLocalAction,
} from "./CanvasFailureCard";

const BootStalledCanvas: Component<{
  /** The whole verdict, tail included: only the `connector` arm carries a `log`, so the
   *  card cannot show a settled connect log over a client-side stall — see
   *  {@link BootStalledRecovery}. */
  recovery: BootStalledRecovery;
}> = (props) => {
  // The two recovery verbs, built ONCE per instance so their identity is stable across every
  // 1s canvas re-resolve (see the REACTIVITY note above) — the connector recycles the SERVER
  // connector (PR1's recheck()), the client one reloads the browser.
  const connectorRecovery = reconnectAction({
    label: "Retry connection",
    testid: "boot-stalled-reconnect",
  });
  const clientRecovery: CanvasFailureAction = {
    label: "Reload",
    testid: "boot-stalled-reload",
    tone: "primary",
    onClick: () => location.reload(),
  };

  // The recovery arm, as two VALUE-deduped payload memos: exactly one is defined at a time — a
  // client leg (Reload card) XOR a connector phase (Retry card). EVERY derivation below reads
  // these, never the fresh-per-tick `props.recovery` object, so a tick that changed nothing
  // re-reads the same primitive and rebuilds nothing (no button churn, no per-second DOM writes).
  // The card can still flip arm/phase IN PLACE — a warming-remote leg can settle to a connected
  // session without the mode leaving `boot-stalled` — which these track by value.
  const clientLeg = createMemo(() =>
    props.recovery.via === "client" ? props.recovery.leg : undefined,
  );
  const connectorPhase = createMemo(() =>
    props.recovery.via === "connector" ? props.recovery.phase : undefined,
  );
  // The connector campaign's own output tail — the narration of the work the card is asking
  // about. A memo like the two above, so the `<For>` inside the card sees a stable array
  // across every 1s re-resolve instead of a fresh reference per tick.
  const connectorLog = createMemo(() =>
    props.recovery.via === "connector" ? props.recovery.log : undefined,
  );

  const actions = createMemo<CanvasFailureAction[]>(() => [
    clientLeg() === undefined ? connectorRecovery : clientRecovery,
    ...switchToLocalAction(),
  ]);
  const copy = createMemo(() => {
    const leg = clientLeg();
    return leg === undefined ? CONNECTOR_STALLED_COPY : bootStalledCopy(leg);
  });
  // The live phase detail — the connector card's only per-phase narration (the client arm's
  // `connectorPhase` is `undefined`, and `bootStalledPhaseDetail(undefined)` is `undefined`).
  const detail = createMemo(() => bootStalledPhaseDetail(connectorPhase()));
  const dataAttrs = createMemo((): Record<string, string> => {
    const leg = clientLeg();
    return leg === undefined
      ? { "data-recovery": "connector" }
      : { "data-recovery": "client", "data-stalled-leg": leg };
  });

  return (
    <CanvasFailureCard
      dataTestid="boot-stalled-canvas"
      dataAttrs={dataAttrs()}
      title={copy().title}
      body={copy().body}
      detail={detail()}
      log={connectorLog()}
      logTestid="boot-stalled-log"
      actions={actions()}
    />
  );
};

export default BootStalledCanvas;
