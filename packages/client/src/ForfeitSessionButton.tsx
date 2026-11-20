import type { Component } from "solid-js";
import InlineConfirmButton from "./ui/InlineConfirmButton";

const ForfeitSessionButton: Component<{
  inFlight: boolean;
  onConfirm: () => void;
}> = (props) => (
  <div class="mx-auto w-fit">
    <InlineConfirmButton
      label="Start fresh"
      inFlightLabel="Start fresh"
      confirmCopy="Start fresh? This discards the saved session and every terminal it would have restored. A state backup is taken first, so “Restore state from backup” in the command palette can bring it back."
      tone="warning"
      inFlight={props.inFlight}
      testid="forfeit-session"
      onConfirm={props.onConfirm}
    />
  </div>
);

export default ForfeitSessionButton;
