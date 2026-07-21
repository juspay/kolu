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
 *
 * REACTIVITY (#1908 D2, codex F2): `canvasMode` returns a FRESH `recovery` object every ~1s
 * monotonic re-resolve, so both recovery verbs are built ONCE per instance and selected through a
 * PRIMITIVE `via` memo (deduped on value). That keeps each action object's identity stable across
 * ticks, so `CanvasFailureCard`'s identity-keyed `<For>` never tears down and recreates a button —
 * a keyboard user focused on Retry connection / Switch to local keeps focus. Copy + phase detail
 * are derived separately, so a phase change narrates without churning the buttons.
 */

import { type Component, createMemo } from "solid-js";
import type { BootStalledRecovery } from "../kaval/canvasModeResolver";
import {
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

const BootStalledCanvas: Component<{ recovery: BootStalledRecovery }> = (
  props,
) => {
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

  // Primitive discriminant — deduped on value, so the action selection below only re-runs when
  // the ARM actually flips, not on every tick that hands us a fresh-but-equal recovery object.
  const via = createMemo(() => props.recovery.via);
  const recovery = createMemo<CanvasFailureAction>(() =>
    via() === "connector" ? connectorRecovery : clientRecovery,
  );
  // switch-to-local, memoized on the active host so its action object is stable across ticks too.
  const switchActions = createMemo(() => switchToLocalAction());
  const actions = createMemo<CanvasFailureAction[]>(() => [
    recovery(),
    ...switchActions(),
  ]);

  // Copy + the live phase detail — derived off the recovery arm, SEPARATELY from the actions so a
  // phase change narrates without re-keying the buttons. Cheap constants (the copy maps), so a
  // tick that leaves the arm/phase unchanged re-reads the same reference and paints nothing new.
  const copy = createMemo(() =>
    props.recovery.via === "connector"
      ? CONNECTOR_STALLED_COPY
      : bootStalledCopy(props.recovery.leg),
  );
  const detail = createMemo(() =>
    props.recovery.via === "connector"
      ? bootStalledPhaseDetail(props.recovery.phase)
      : undefined,
  );
  const dataAttrs = createMemo((): Record<string, string> => {
    const r = props.recovery;
    return r.via === "connector"
      ? { "data-recovery": "connector" }
      : { "data-recovery": "client", "data-stalled-leg": r.leg };
  });

  return (
    <CanvasFailureCard
      dataTestid="boot-stalled-canvas"
      dataAttrs={dataAttrs()}
      title={copy().title}
      body={copy().body}
      detail={detail()}
      actions={actions()}
    />
  );
};

export default BootStalledCanvas;
