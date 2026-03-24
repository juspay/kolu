/** Reusable tooltip wrapper for header icon buttons. */

import { type Component, type JSX } from "solid-js";
import Tooltip from "@corvu/tooltip";

const HeaderTooltip: Component<{
  label: string;
  children: JSX.Element;
}> = (props) => {
  return (
    <Tooltip openDelay={400} closeDelay={0}>
      <Tooltip.Trigger as="div">{props.children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="z-50 px-2 py-1 text-xs text-fg bg-surface-2 rounded shadow-lg border border-edge-bright">
          {props.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
};

export default HeaderTooltip;
