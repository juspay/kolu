/** Minimal segmented-control — a row of mutually-exclusive buttons used in
 *  SettingsPopover for enum-typed settings (color scheme, theme mode,
 *  sidebar agent previews). Each button gets a `data-testid` of the form
 *  `${testIdPrefix}-${value}` so e2e tests can click the option directly. */

import { For, type JSX } from "solid-js";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

export default function SegmentedControl<T extends string>(props: {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Prefix for `data-testid` attributes on the group and each option. */
  testIdPrefix: string;
}): JSX.Element {
  return (
    <div
      data-testid={`${props.testIdPrefix}-toggle`}
      class="flex rounded-lg overflow-hidden border border-edge"
    >
      <For each={props.options}>
        {(opt) => (
          <button
            type="button"
            data-testid={`${props.testIdPrefix}-${opt.value}`}
            class="px-2 py-0.5 text-xs transition-colors cursor-pointer"
            classList={{
              "bg-accent text-surface-0": props.value === opt.value,
              "bg-surface-2 text-fg-2 hover:text-fg": props.value !== opt.value,
            }}
            onClick={() => props.onChange(opt.value)}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}
