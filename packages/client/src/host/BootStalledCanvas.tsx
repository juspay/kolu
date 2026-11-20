import { type Component, createMemo } from "solid-js";
import { NO_LOG_LINES } from "@kolu/solid-logtail";
import {
  bootStalledCopy,
  bootStalledPhaseDetail,
  CONNECTOR_STALLED_COPY,
} from "../kaval/bootStalledCopy";
import type { BootStalledRecovery } from "../kaval/canvasModeResolver";
import {
  type CanvasFailureAction,
  CanvasFailureCard,
  type CardLogAbsence,
  reconnectAction,
  switchToLocalAction,
} from "./CanvasFailureCard";

const BootStalledCanvas: Component<{
  recovery: BootStalledRecovery;
}> = (props) => {
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

  const clientLeg = createMemo(() =>
    props.recovery.via === "client" ? props.recovery.leg : undefined,
  );
  const connectorPhase = createMemo(() =>
    props.recovery.via === "connector" ? props.recovery.phase : undefined,
  );
  const connectorLog = createMemo(() =>
    props.recovery.via === "connector" ? props.recovery.log : NO_LOG_LINES,
  );
  const connectorLogAbsence = createMemo<CardLogAbsence>(() =>
    props.recovery.via === "connector"
      ? (props.recovery.logAbsence ?? "none")
      : "none",
  );

  const actions = createMemo<CanvasFailureAction[]>(() => [
    clientLeg() === undefined ? connectorRecovery : clientRecovery,
    ...switchToLocalAction(),
  ]);
  const copy = createMemo(() => {
    const leg = clientLeg();
    return leg === undefined ? CONNECTOR_STALLED_COPY : bootStalledCopy(leg);
  });
  const detail = createMemo(() =>
    bootStalledPhaseDetail(
      connectorPhase(),
      props.recovery.via === "connector" ? props.recovery.quiet : undefined,
    ),
  );
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
      logAbsence={connectorLogAbsence()}
      logTestid="boot-stalled-log"
      actions={actions()}
    />
  );
};

export default BootStalledCanvas;
