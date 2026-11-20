import { runAction } from "../runAction";
import type { Component } from "solid-js";
import { RestartIcon } from "../ui/Icons";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { activeHost } from "../wire";
import { renewDaemon, renewInFlight } from "./useDaemonRestart";

const UpdateKavalButton: Component<{
  tone: "neutral" | "danger";
  onConfirm?: () => void;
}> = (props) => (
  <InlineConfirmButton
    label="Update & restart kaval"
    inFlightLabel="Updating…"
    confirmCopy="Update & restart this host's kaval? This drains the host daemon, re-provisions the current build on the host, and starts a correct-version kaval — the terminals on this host restart."
    tone={props.tone}
    inFlight={renewInFlight(activeHost())}
    icon={<RestartIcon class="h-3.5 w-3.5" />}
    testid="update-kaval"
    onConfirm={() => {
      props.onConfirm?.();
      runAction("update kaval", renewDaemon(activeHost()));
    }}
  />
);

export default UpdateKavalButton;
