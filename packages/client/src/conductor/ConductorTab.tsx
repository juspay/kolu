/** `◆ Conductor` — the conversation's own tab, FIRST in the chrome bar's tab
 *  row.
 *
 *  The conversation is a PLACE you go, like a host, so it is drawn the way a
 *  place is drawn in this row: a tab, the same shape as the host tabs beside
 *  it (`.host-tab` — rounded top, sitting on the rail floor, a raised belly
 *  when it is where you are). It goes FIRST because it is the one place that
 *  reaches every host, and because a tab pinned before the hosts never moves
 *  when one joins or leaves.
 *
 *  What keeps it from reading as a host is everything a host tab carries that
 *  it does not: no connection dot (there is no connection of its own to
 *  report), the ◆ mark, and the `alpha` tag — and its OWN COLOUR, which no
 *  host has. `--color-conductor` is a theme token (light and dark, in
 *  `@kolu/theme`) and it stands in as this tab's `--host-hue`, so the host
 *  tabs' shared hover and lit belly paint it in the conductor's colour; unlike
 *  a host, it wears that colour AT REST too, because it is not one of a set
 *  you are choosing between — it is the one place that reaches all of them,
 *  and in grey it read as the weakest tab on the row. It is not a host
 *  anywhere else either: no host key, no entry in the host map, nothing in the
 *  host switcher's data model, and it is mounted beside the host strip, not
 *  inside it.
 *
 *  EXACTLY ONE TAB LOOKS CURRENT. While the conversation is on screen this tab
 *  is lit and no host tab is (`useActiveHostSelector` folds the conductor in);
 *  the host you came from is still remembered for the way back, just not
 *  painted. Pressing it enters the conversation and pressing it again does
 *  nothing, as with any tab — a host tab is the way back. `⌘⇧O` still toggles
 *  both ways.
 *
 *  Its badge is the violet needs-you count — the questions the one
 *  conversation is blocked on, across every host it has terminals on. It sits
 *  on the tab's top-right CORNER rather than inline, so the tab's width does
 *  not move when a question arrives; and the tab washes violet while it is not
 *  the current one, the same `data-asking` channel a host tab uses. ABSENT at
 *  zero, never a `0`: a badge that renders its own silence is one every reader
 *  has to parse before ignoring.
 *
 *  The `alpha` tag is INLINE, and that is the opposite choice for the opposite
 *  reason. The corner is taken, and two things stacked there would overlap on
 *  the one press that matters. More to the point the tag is a constant — it is
 *  true of the feature, not of the moment — so it is part of the tab's width
 *  from the first paint and never moves the row, which is exactly what the
 *  badge could not promise. */

import { type Component, Show } from "solid-js";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import { conductorAsksTotal } from "./useConductorFacts";
import { enterConductorMode, conductorMode } from "./useConductorMode";

const ConductorTab: Component = () => (
  <Tip label={`Conductor (${formatKeybind(ACTIONS.toggleConductor.keybind)})`}>
    <button
      type="button"
      data-testid="conductor-tab"
      data-active={conductorMode() ? "" : undefined}
      data-asking={
        conductorAsksTotal() > 0 && !conductorMode() ? "" : undefined
      }
      aria-current={conductorMode() ? "page" : undefined}
      // `--host-hue` and the resting ink come from `.conductor-tab`
      // (index.css), which feeds the host tabs' shared hover / lit-belly rules
      // with `--color-conductor` — the tab's own theme token, defined light
      // and dark in `@kolu/theme`. No colour is spelled here: a raw hex on a
      // tab is a tab that is wrong in one of the two themes.
      class={`host-tab conductor-tab ${conductorMode() ? "host-tab-active" : "host-tab-idle"} pointer-events-auto relative -mb-px flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-xs font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-conductor/50`}
      onClick={() => enterConductorMode()}
    >
      {/* The ◆ inherits the tab's ink (`currentColor`): at rest that is the
          conductor's own colour, and on the lit tab it is the foreground the
          shared `.host-tab-active` sets — one mark, never two colour sources
          to disagree about which state it is in. */}
      <span aria-hidden="true">◆</span>
      Conductor
      <span
        data-testid="conductor-alpha"
        class="rounded-sm bg-fg-3/15 px-1 py-px font-mono text-[0.58rem] font-semibold uppercase tracking-[0.08em] leading-[1.4] text-fg-3"
      >
        alpha
      </span>
      <Show when={conductorAsksTotal() > 0}>
        <span
          data-testid="conductor-badge"
          class="absolute -top-1.5 -right-1.5 min-w-4 rounded-full bg-alert px-1 text-center text-[0.6rem] font-semibold leading-4 text-surface-0"
        >
          {conductorAsksTotal()}
        </span>
      </Show>
    </button>
  </Tip>
);

export default ConductorTab;
