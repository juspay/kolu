import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import {
  type LandedFacts,
  landedFacts,
  updateLanded,
} from "@kolu/agent-distro/status";
import { createEffect } from "solid-js";

export function watchLanding(
  read: () => AgentDistroStatus | undefined,
  onLanded: (set: string) => void,
): void {
  let prev: LandedFacts | undefined;
  createEffect(() => {
    const now = landedFacts(read());
    const landed = updateLanded(prev, now);
    prev = now;
    if (landed && now !== undefined) onLanded(now.set);
  });
}
