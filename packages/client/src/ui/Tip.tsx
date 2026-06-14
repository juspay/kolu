/** Tooltip wrapper — wraps any element with a Corvu Tooltip on hover. */

import Tooltip from "@corvu/tooltip";
import type { Component, JSX } from "solid-js";

const Tip: Component<{
  /** Tooltip body — a plain string or JSX for most call sites, or a **thunk**
   *  (`() => JSX.Element`) for an expensive body. The thunk is evaluated lazily
   *  inside the portal's open-gate (below), so a body with live subscriptions
   *  (e.g. the IdentityRail breakdown, which reads a 1s clock) only runs — and
   *  only subscribes — while the tooltip is shown; a closed tooltip costs
   *  nothing. A bare string/JSX is a valid `JSX.Element`, so existing call sites
   *  are unaffected. */
  label: JSX.Element | (() => JSX.Element);
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
          {/* Content mounts only when open (Corvu gates the Portal on a `<Show>`),
              so a thunk label is evaluated — and its reads subscribed — only then. */}
          {typeof props.label === "function"
            ? (props.label as () => JSX.Element)()
            : props.label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
};

export default Tip;
