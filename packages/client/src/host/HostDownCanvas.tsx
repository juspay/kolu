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
  const failure = createMemo(() => {
    const episode = failedEpisode(activeEntryState());
    if (episode === undefined) {
      throw new Error(`HostDownCanvas: entry is ${activeEntryState().kind}`);
    }
    return episode;
  });
  const copy = () => hostDownCopy(failure().cause);
  const actions = (): CanvasFailureAction[] => [
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
      logAbsence="none"
      logTestid="host-down-log"
      footer={<DocLink slug="remote-hosts">Learn more →</DocLink>}
      actions={actions()}
    />
  );
};

export default HostDownCanvas;
