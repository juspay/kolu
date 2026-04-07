/** Tooltip wrapper — wraps any element with a Corvu Tooltip on hover. */

import { type Component, type JSX } from "solid-js";
import Tooltip from "@corvu/tooltip";

const Tip: Component<{
  label: string;
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
