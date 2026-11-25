/** agent-distro's mark on a TOAST, in a module of its own because the three
 *  surfaces that raise those toasts (the Agents switch, the landing
 *  announcement, a restart) must not pull one another's facts in to put a
 *  logo on a line. */

import AgentDistroLogo from "@kolu/agent-distro/solid";
import type { JSX } from "@solidjs/web";
import { createRoot } from "solid-js";

/** A toast is raised from an event handler or an effect function, and neither
 *  is an owner, so the mark's element would be built ownerless
 *  (NO_OWNER_EFFECT) — and sonner holds the ELEMENT itself (Solid 2's
 *  `JSX.Element` is never a function). It is built in a root disposed the
 *  moment the node exists: the mark's props are constant, so its bindings
 *  have nothing left to run, and no root is left behind per toast. */
export function agentDistroToastIcon(): JSX.Element {
  return createRoot((dispose) => {
    const mark = AgentDistroLogo({ size: 16 });
    dispose();
    return mark;
  });
}
