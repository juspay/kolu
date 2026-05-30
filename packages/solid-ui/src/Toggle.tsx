/** Minimal toggle switch — used in SettingsPopover for boolean settings. */

import type { Component } from "solid-js";

const Toggle: Component<{
  enabled: boolean;
  onChange: (on: boolean) => void;
  testId: string;
}> = (props) => (
  <button
    type="button"
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
