/** Pure renderer for a terminal's user-chosen icon — emoji or any
 *  short string. Owns the unset fallback (`<Show when>`) so each call
 *  site is a one-liner; takes a scalar prop, not `TerminalDisplayInfo`,
 *  so surfaces that consume `TerminalMetadata` directly (like
 *  `SubPanelTabBar`) can use the same component without rewiring.
 *
 *  Named `TerminalUserIcon` (not `TerminalIcon`) because a SVG glyph
 *  component named `TerminalIcon` already lives in `../ui/Icons.tsx`
 *  for the generic terminal-window symbol; identical names + identical
 *  `class?: string` shape would let a wrong-path auto-import silently
 *  render the wrong thing with no type error.
 *
 *  Per-terminal scope is established by the field declaration in
 *  `surface.ts`; this component does not inject any default. */

import { type Component, Show } from "solid-js";

const TerminalUserIcon: Component<{
  icon: string | undefined;
  /** Tailwind size + spacing applied to the outer span. The default
   *  matches what every dock / switcher / sub-tab call site needs;
   *  override only when a surface genuinely diverges (e.g. the dock
   *  rail-segment overlay uses `text-base` + `mix-blend-multiply`). */
  class?: string;
}> = (props) => (
  <Show when={props.icon}>
    {(icon) => (
      <span
        data-testid="terminal-icon"
        class={props.class ?? "text-sm leading-none shrink-0"}
        aria-hidden="true"
      >
        {icon()}
      </span>
    )}
  </Show>
);

export default TerminalUserIcon;
