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
 *  (and grows its hit targets on a coarse pointer when `touch` is set).
 *
 *  Keyboard, for every caller: ONE tab stop (a roving tabindex) — the pressed
 *  option, or `restingValue` while none is — and ← → (Home / End) move focus
 *  within the group, wrapping; Enter or Space picks the focused option, once.
 *  Neither Corvu nor `@solid-primitives` ships a roving-focus primitive, so it
 *  lives here, once. Buttons are keyed by `value` (`Key`), so a caller that
 *  hands in fresh option objects for the same values (a re-emitted listing)
 *  keeps the very buttons — and the focus — it had. */

import { Key } from "@solid-primitives/keyed";
import {
  type Component,
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  onCleanup,
  on,
  onMount,
  Show,
} from "solid-js";
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

/** The roving tab stop: the option focus last moved to while inside the group,
 *  else the pressed one, else the resting one, else the first. */
export function rovingTabStop<T extends string>(input: {
  readonly options: readonly { readonly value: T }[];
  readonly focused: T | undefined;
  readonly value: T | undefined;
  readonly restingValue: T | undefined;
}): T | undefined {
  const has = (v: T | undefined): v is T =>
    v !== undefined && input.options.some((o) => o.value === v);
  if (has(input.focused)) return input.focused;
  if (has(input.value)) return input.value;
  if (has(input.restingValue)) return input.restingValue;
  return input.options[0]?.value;
}

/** Where an arrow key moves focus from index `from` in a group of `count`
 *  (wrapping), or `undefined` for a key the group does not handle. */
export function rovingMove(
  key: string,
  from: number,
  count: number,
): number | undefined {
  if (count === 0) return undefined;
  switch (key) {
    case "ArrowLeft":
      return (from - 1 + count) % count;
    case "ArrowRight":
      return (from + 1) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

export default function SegmentedControl<T extends string>(props: {
  options: readonly SegmentedControlOption<T>[];
  /** The pressed option — `undefined` when none is (nothing chosen yet). */
  value: T | undefined;
  onChange: (value: T) => void;
  /** The option that holds the tab stop while none is pressed (default: the
   *  first). */
  restingValue?: T;
  /** Focus the tab stop when the control mounts — only if nothing else holds
   *  the focus (or what holds it is in the same dialog), so a control that
   *  mounts late never steals it from, say, an open palette. */
  autofocus?: boolean;
  /** Told the roving tab stop ({@link rovingTabStop}) — at mount and each
   *  time it moves: the option under the keyboard focus while focus is in the
   *  group, else the pressed one, else the resting one. THE answer to "which
   *  option is in view", so a caller that speaks about it never re-derives it. */
  onTabStopChange?: (value: T | undefined) => void;
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
  const buttons = new Map<T, HTMLButtonElement>();
  const [focused, setFocused] = createSignal<T | undefined>();
  const focusOn = (value: T | undefined) => setFocused(() => value);
  // A memo: every button reads it, and the caller hears it only when it moves.
  const tabStop = createMemo(() =>
    rovingTabStop({
      options: props.options,
      focused: focused(),
      value: props.value,
      restingValue: props.restingValue,
    }),
  );
  const tabIndexOf = (value: T) => (tabStop() === value ? 0 : -1);
  // A render effect, so the caller hears the stop before the first paint.
  createRenderEffect(on(tabStop, (stop) => props.onTabStopChange?.(stop)));
  const keep = (value: T) => (el: HTMLButtonElement) => {
    buttons.set(value, el);
    onCleanup(() => {
      if (buttons.get(value) === el) buttons.delete(value);
    });
  };
  const onKeyDown = (value: T) => (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    // Enter / Space pick the focused option HERE, with the browser's own
    // activation prevented, so a pick is exactly one change.
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onChange(value);
      return;
    }
    const from = props.options.findIndex((o) => o.value === value);
    const to = rovingMove(e.key, Math.max(from, 0), props.options.length);
    if (to === undefined) return;
    e.preventDefault();
    const next = props.options[to];
    if (next !== undefined) buttons.get(next.value)?.focus();
  };
  // Leaving the group hands the tab stop back to the pressed option.
  const onFocusOut = (e: FocusEvent) => {
    const to = e.relatedTarget;
    if (
      !(to instanceof HTMLButtonElement) ||
      ![...buttons.values()].includes(to)
    )
      focusOn(undefined);
  };
  onMount(() => {
    if (!props.autofocus) return;
    // After the frame, so a dialog's own initial focus does not win over it.
    requestAnimationFrame(() => {
      const stop = tabStop();
      const target = stop === undefined ? undefined : buttons.get(stop);
      if (target === undefined) return;
      const active = document.activeElement;
      const dialog = target.closest('[role="dialog"]');
      const free =
        active === null ||
        active === document.body ||
        dialog?.contains(active) === true;
      if (free) target.focus();
    });
  });
  return (
    <Show
      when={props.ariaRole === "toolbar"}
      fallback={
        <div
          data-testid={`${props.testIdPrefix}-toggle`}
          class="flex rounded-lg overflow-hidden border border-edge"
        >
          <Key each={props.options} by="value">
            {(opt) => (
              <button
                type="button"
                ref={keep(opt().value)}
                data-testid={`${props.testIdPrefix}-${opt().value}`}
                aria-pressed={props.value === opt().value}
                tabIndex={tabIndexOf(opt().value)}
                onFocus={() => focusOn(opt().value)}
                onFocusOut={onFocusOut}
                onKeyDown={onKeyDown(opt().value)}
                title={opt().hint}
                class="px-2 py-0.5 text-xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50"
                classList={{
                  "bg-accent text-surface-0": props.value === opt().value,
                  "bg-surface-2 text-fg-2 hover:text-fg":
                    props.value !== opt().value,
                }}
                onClick={() => props.onChange(opt().value)}
              >
                {opt().label}
              </button>
            )}
          </Key>
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
        <Key each={props.options} by="value">
          {(opt) => (
            <>
              <Show when={opt().dividerBefore}>
                <div
                  class="self-stretch w-px bg-edge/60 mx-0.5"
                  aria-hidden="true"
                />
              </Show>
              <button
                type="button"
                ref={keep(opt().value)}
                data-testid={`${props.testIdPrefix}-${opt().value}`}
                aria-pressed={props.value === opt().value}
                tabIndex={tabIndexOf(opt().value)}
                onFocus={() => focusOn(opt().value)}
                onFocusOut={onFocusOut}
                onKeyDown={onKeyDown(opt().value)}
                data-active={props.value === opt().value ? "" : undefined}
                data-mode={opt().value}
                title={opt().hint}
                data-touch={props.touch || undefined}
                class="flex items-center gap-1.5 px-2 data-[touch=true]:px-2.5 h-5 data-[touch=true]:h-7 rounded text-[10px] data-[touch=true]:text-[11px] font-mono cursor-pointer transition-colors text-fg-2 hover:text-fg hover:bg-surface-2/60 data-active:bg-surface-0 data-active:text-fg data-active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                onClick={() => props.onChange(opt().value)}
              >
                <Show when={opt().icon}>
                  {(icon) => (
                    <Dynamic component={icon()} class="w-3 h-3 opacity-70" />
                  )}
                </Show>
                <span>{opt().label}</span>
                <Show when={(opt().badge ?? 0) > 0}>
                  <span
                    class="inline-flex items-center justify-center h-3.5 min-w-3.5 px-1 rounded-full bg-accent/20 text-fg text-[0.6rem] font-semibold tabular-nums"
                    data-testid={`${props.testIdPrefix}-${opt().value}-count`}
                  >
                    {opt().badge}
                  </span>
                </Show>
              </button>
            </>
          )}
        </Key>
      </div>
    </Show>
  );
}
