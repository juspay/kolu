/** Tooltip wrapper — wraps any element with a Corvu Tooltip on hover. */

import Tooltip from "@corvu/tooltip";
import type { Component, JSX } from "solid-js";

const Tip: Component<{
  /** Tooltip body — a plain string for most call sites, or rich JSX (e.g. the
   *  IdentityRail's per-source breakdown table). A bare string is a valid
   *  `JSX.Element`, so existing string call sites are unaffected. */
  label: JSX.Element;
  class?: string;
  children: JSX.Element;
}> = (props) => {
  return (
    <Tooltip openDelay={400} closeDelay={0}>
      <Tooltip.Trigger as="div" class={props.class}>
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="z-50 px-2 py-1 text-xs text-fg bg-surface-2 rounded-lg shadow-lg shadow-black/40 border border-edge">
          {props.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
};

export default Tip;
