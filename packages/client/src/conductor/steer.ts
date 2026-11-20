import type { ConductorState } from "kolu-common/conductor";
import type { Keybind } from "../input/keyboard";

export const STEER_KEYBIND: Keybind = { key: "Enter", alt: true };

export function steerOnOffer(
  state: Pick<ConductorState, "steers" | "phase">,
): boolean {
  return (
    state.steers && (state.phase === "working" || state.phase === "asking")
  );
}

export function sendsAsSteer(alt: boolean, offered: boolean): boolean {
  return alt && offered;
}
