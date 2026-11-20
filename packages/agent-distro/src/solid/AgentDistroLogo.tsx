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
