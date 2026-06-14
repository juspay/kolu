/** Segmented control — a row of mutually-exclusive buttons. The single
 *  receptacle for "render a row of visible options, report the one the user
 *  picks": SettingsPopover uses the plain enum form (color scheme, theme mode,
 *  terminal renderer); the Code tab's scope switcher uses the same primitive
 *  with per-option icons, change-count badges, and a group divider plus a
 *  `toolbar` ARIA role. Every button gets a `data-testid` of the form
 *  `${testIdPrefix}-${value}` so e2e tests can click the option directly.
 *
 *  The "rich" affordances (icon / hint / badge / dividerBefore, and the
 *  control-level `ariaRole` / `ariaLabel` / `dataMode` / `touch`) are all
 *  optional and inert when unset, so the plain settings call sites render
 *  exactly as before while the scope switcher renders the toolbar variant
 *  (and grows its hit targets on a coarse pointer when `touch` is set). */

import { type Component, For, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  /** Leading glyph. The host owns the icon registry so the control doesn't
   *  import every possible icon. Renders in the toolbar variant only. */
  icon?: Component<{ class?: string }>;
  /** Tooltip (title attr) — a longer description shown on hover. */
  hint?: string;
  /** Change-count badge; rendered only when present and `> 0`. Absent means
   *  the option is never badged (a structurally non-badgeable option, or one
   *  with no number to show right now). */
  badge?: number;
  /** Draw a group divider immediately before this option. The host sets it on
   *  the first option of a new visual group; the control draws the divider
   *  with no inter-option comparison. */
  dividerBefore?: boolean;
}

export default function SegmentedControl<T extends string>(props: {
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Prefix for `data-testid` attributes on the group and each option. */
  testIdPrefix: string;
  /** ARIA role for the group container. `"toolbar"` opts into the rich
   *  scope-switcher chrome (icons, badges, dividers, per-button active
   *  styling); unset keeps the plain enum chrome the settings popover uses. */
  ariaRole?: "toolbar";
  /** Accessible label for the group, used when `ariaRole` is set. */
  ariaLabel?: string;
  /** Mirror the active `value` onto a `data-mode` attribute on the group, so
   *  tests can read the selection without interaction. */
  dataMode?: boolean;
  /** Enlarge the toolbar variant's hit targets for a coarse pointer (the host
   *  passes `isTouch()`): segments grow 20px → 28px tall so a tap clears the
   *  WCAG 2.2 24px floor, mirroring the Code-tab tree's touch density. Ignored
   *  by the plain (settings) variant. */
  touch?: boolean;
}): JSX.Element {
  return (
    <Show
      when={props.ariaRole === "toolbar"}
      fallback={
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
                  "bg-surface-2 text-fg-2 hover:text-fg":
                    props.value !== opt.value,
                }}
                onClick={() => props.onChange(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      }
    >
      <div
        data-testid={`${props.testIdPrefix}-toggle`}
        role="toolbar"
        aria-label={props.ariaLabel}
        data-mode={props.dataMode ? props.value : undefined}
        data-touch={props.touch || undefined}
        class="flex items-center gap-0.5 data-[touch=true]:gap-1 shrink-0 rounded bg-surface-2/40 p-0.5 data-[touch=true]:p-1"
      >
        <For each={props.options}>
          {(opt) => (
            <>
              <Show when={opt.dividerBefore}>
                <div
                  class="self-stretch w-px bg-edge/60 mx-0.5"
                  aria-hidden="true"
                />
              </Show>
              <button
                type="button"
                data-testid={`${props.testIdPrefix}-${opt.value}`}
                aria-pressed={props.value === opt.value}
                data-active={props.value === opt.value}
                data-mode={opt.value}
                title={opt.hint}
                data-touch={props.touch || undefined}
                class="flex items-center gap-1.5 px-2 data-[touch=true]:px-2.5 h-5 data-[touch=true]:h-7 rounded text-[10px] data-[touch=true]:text-[11px] font-mono cursor-pointer transition-colors text-fg-2 hover:text-fg hover:bg-surface-2/60 data-[active=true]:bg-surface-0 data-[active=true]:text-fg data-[active=true]:shadow-sm"
                onClick={() => props.onChange(opt.value)}
              >
                <Show when={opt.icon}>
                  {(icon) => (
                    <Dynamic component={icon()} class="w-3 h-3 opacity-70" />
                  )}
                </Show>
                <span>{opt.label}</span>
                <Show when={opt.badge !== undefined && opt.badge > 0}>
                  <span
                    class="inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded-full bg-accent/20 text-fg text-[0.6rem] font-semibold tabular-nums"
                    data-testid={`${props.testIdPrefix}-${opt.value}-count`}
                  >
                    {opt.badge}
                  </span>
                </Show>
              </button>
            </>
          )}
        </For>
      </div>
    </Show>
  );
}
