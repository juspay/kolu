/** One row in SettingsPopover — label + control on top, optional hint underneath.
 *  Label is the hero (`text-fg font-medium`); hint recedes (`text-fg-3/70`) so
 *  attention lands on the control, not the copy. TONE_CONFIG owns both the
 *  color class and the glyph prefix so a new tone entry updates both in one
 *  place. Default tone is "muted". */

import { type Component, type JSX, Show } from "solid-js";

const TONE_CONFIG = {
  muted: { colorClass: "text-fg-3/70", glyph: "" },
  warn: { colorClass: "text-warning", glyph: "⚠ " },
} as const;

export type Hint = { text: string; tone?: keyof typeof TONE_CONFIG };

const SettingRow: Component<{
  label: string;
  hint?: Hint;
  children: JSX.Element;
}> = (props) => (
  <div>
    <div class="flex items-center justify-between gap-4">
      <span class="text-sm font-medium text-fg">{props.label}</span>
      {props.children}
    </div>
    <Show when={props.hint}>
      {(hint) => {
        const cfg = () => TONE_CONFIG[hint().tone ?? "muted"];
        return (
          <p class={`mt-1.5 text-xs leading-relaxed ${cfg().colorClass}`}>
            <Show when={cfg().glyph}>
              <span aria-hidden="true">{cfg().glyph}</span>
            </Show>
            {hint().text}
          </p>
        );
      }}
    </Show>
  </div>
);

export default SettingRow;
