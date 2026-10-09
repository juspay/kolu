/** Minimal toggle switch — used in SettingsPopover for boolean settings, and
 *  as the Agents switch (Settings and the welcome card's first-run step). */

import type { Component } from "solid-js";

const Toggle: Component<{
  enabled: boolean;
  onChange: (on: boolean) => void;
  testId: string;
  /** Its accessible name, where no visible label is tied to it. */
  label?: string;
  /** Focus it on mount (the first-run step, while nothing is chosen). */
  autofocus?: boolean;
}> = (props) => (
  <button
    ref={(el) => {
      if (props.autofocus) queueMicrotask(() => el.focus());
    }}
    type="button"
    role="switch"
    aria-checked={props.enabled}
    aria-label={props.label}
    data-testid={props.testId}
    data-enabled={props.enabled ? "" : undefined}
    class="relative w-8 h-4 rounded-full transition-colors cursor-pointer"
    classList={{
      "bg-accent": props.enabled,
      "bg-surface-3": !props.enabled,
    }}
    onClick={() => props.onChange(!props.enabled)}
  >
    <span
      class="absolute top-0.5 w-3 h-3 rounded-full bg-fg transition-transform"
      classList={{
        "left-[18px]": props.enabled,
        "left-0.5": !props.enabled,
      }}
    />
  </button>
);

export default Toggle;
