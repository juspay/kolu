/** Tooltip wrapper — wraps any element with a Corvu Tooltip on hover. */

import Tooltip from "@corvu-next/tooltip";
import type { Component } from "solid-js";
import type { JSX } from "@solidjs/web";

const Tip: Component<{
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
