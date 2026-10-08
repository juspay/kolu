/** One row in SettingsPopover — label + control on top, optional hint underneath.
 *  Label is the hero (`text-fg font-medium`); hint recedes (`text-fg-3/70`) so
 *  attention lands on the control, not the copy. TONE_CONFIG owns both the
 *  color class and the glyph prefix so a new tone entry updates both in one
 *  place. Default tone is "muted". Optional `details` render under the hint,
 *  and optional `doc` a trailing docs link below them. */

import { type Component, type JSX, Show } from "solid-js";
import DocLink, { type DocSlug } from "../ui/DocLink";

const TONE_CONFIG = {
  muted: { colorClass: "text-fg-3/70", glyph: "" },
  warn: { colorClass: "text-warning", glyph: "⚠ " },
} as const;

export type Hint = { text: string; tone?: keyof typeof TONE_CONFIG };

/** THE hint renderer — how a hint looks (its tone's colour and glyph), decided
 *  once, for a Settings row and anywhere else a setting's hint is shown (the
 *  welcome card's first-run Agents step). `class` is spacing only. */
export const SettingHint: Component<{ hint: Hint; class?: string }> = (
  props,
) => {
  const cfg = () => TONE_CONFIG[props.hint.tone ?? "muted"];
  return (
    // `whitespace-pre-line`: a hint may carry a second line (the Agent
    // profile row's harness list); a one-line hint renders as before.
    <p
      class={`text-xs leading-relaxed whitespace-pre-line ${cfg().colorClass} ${props.class ?? ""}`}
    >
      <Show when={cfg().glyph}>
        <span aria-hidden="true">{cfg().glyph}</span>
      </Show>
      {props.hint.text}
    </p>
  );
};

const SettingRow: Component<{
  label: string;
  /** Optional mark shown before the label (the Agents row's agent-distro logo). */
  icon?: JSX.Element;
  hint?: Hint;
  /** Optional detail under the hint (the Agents row's per-host status lines). */
  details?: JSX.Element;
  /** Optional product-docs slug — renders a "Docs →" link under the hint. */
  doc?: DocSlug;
  /** Optional quieter link beside "Docs →" (the Agents row's "Provided by
   *  agent-distro ↗"). */
  aside?: JSX.Element;
  children: JSX.Element;
}> = (props) => (
  <div>
    {/* Wrap the control below the label when it can't fit beside it (a wide
     *  control like the 5-segment "New terminal theme" picker in the narrow
     *  mobile chrome sheet) rather than clipping it off the popover edge. On a
     *  wide popover everything stays on one line. */}
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <span class="flex items-center gap-1.5 text-sm font-medium text-fg">
        {props.icon}
        {props.label}
      </span>
      {props.children}
    </div>
    <Show when={props.hint}>
      {(hint) => <SettingHint hint={hint()} class="mt-1.5" />}
    </Show>
    {props.details}
    <Show when={props.doc}>
      {(slug) => (
        <div class="mt-1 flex items-baseline gap-3 text-xs">
          <DocLink slug={slug()}>Docs →</DocLink>
          {props.aside}
        </div>
      )}
    </Show>
  </div>
);

export default SettingRow;
