/** agent-distro's mark — shown everywhere kolu names agent-distro (the tile's
 *  agents pill, the Settings "Agents" row, the host tab's download badge, the
 *  "Agents ready" toast), so the agents are visibly agent-distro's.
 *
 *  `agent-distro-logo.svg` is agent-distro's own `doc/logo.svg`, vendored
 *  verbatim from the npins pin. It is inlined (Vite `?raw`), not an `<img>`: its
 *  strokes are `currentColor`, so the mark takes the surrounding text colour
 *  (muted in a pill, warning in an error badge), while its three dots keep their
 *  own colours. Decorative — the text beside it always says "agent-distro" or
 *  the profile, so it is hidden from assistive tech. */

import type { Component } from "solid-js";
import logo from "./agent-distro-logo.svg?raw";

const AgentDistroLogo: Component<{ size: number; class?: string }> = (
  props,
) => (
  <span
    aria-hidden="true"
    data-testid="agent-distro-logo"
    class={`inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full ${props.class ?? ""}`}
    style={{ width: `${props.size}px`, height: `${props.size}px` }}
    innerHTML={logo}
  />
);

export default AgentDistroLogo;
