import type { Component } from "solid-js";
import { RestartIcon } from "../ui/Icons";
import InlineConfirmButton from "../ui/InlineConfirmButton";

const RestartKavalButton: Component<{
  inFlight: boolean;
  tone: "neutral" | "danger";
  onConfirm: () => void;
}> = (props) => (
  <InlineConfirmButton
    label="Restart kaval"
    inFlightLabel="Restarting…"
    confirmCopy="Restart kaval? This stops the daemon and every running terminal — your session is captured first and offered for restore on the fresh daemon."
    tone={props.tone}
    inFlight={props.inFlight}
    icon={<RestartIcon class="h-3.5 w-3.5" />}
    testid="restart-kaval"
    onConfirm={props.onConfirm}
  />
);

export default RestartKavalButton;
