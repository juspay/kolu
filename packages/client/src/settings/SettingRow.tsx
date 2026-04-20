/** One row in SettingsPopover — label + control on top, optional hint underneath.
 *  The hint is what makes the popover self-documenting: static strings for
 *  toggles, per-value tables for segmented controls (see SettingsPopover.tsx).
 *  `tone: "warn"` flags a trade-off (e.g. WebGL-every-tile context thrash). */

import { type Component, type JSX, Show } from "solid-js";

export type Hint = { text: string; tone?: "muted" | "warn" };

const SettingRow: Component<{
  label: string;
  hint?: Hint;
  children: JSX.Element;
}> = (props) => (
  <div class="text-sm">
    <div class="flex items-center justify-between gap-3">
      <span class="text-fg-2">{props.label}</span>
      {props.children}
    </div>
    <Show when={props.hint}>
      {(hint) => (
        <p
          class={
            hint().tone === "warn"
              ? "mt-1 text-xs text-warning"
              : "mt-1 text-xs text-fg-3"
          }
        >
          <Show when={hint().tone === "warn"}>
            <span aria-hidden="true">⚠ </span>
          </Show>
          {hint().text}
        </p>
      )}
    </Show>
  </div>
);

export default SettingRow;
