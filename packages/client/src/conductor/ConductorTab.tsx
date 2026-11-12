/** `◆ Conductor` — the conversation's own entry in the chrome bar.
 *
 *  It sits in the same row as the host tabs and is deliberately NOT one of
 *  them. A host tab is a browser-tab shape with a connection dot, the host's
 *  own hue and a "+" beside its group, because a host is a machine whose
 *  reachability you watch; the conductor is one conversation that reaches
 *  every machine, with no connection of its own to report. So this is a PILL,
 *  pinned at the end of the row — same row, visibly a different kind of thing.
 *
 *  It is not a host anywhere else either: no host key, no entry in the host
 *  map, nothing in the host switcher's data model. Selecting it enters
 *  conductor mode; selecting any host tab leaves it; `⌘⇧O` does both.
 *
 *  ## Why it looks like this
 *
 *  It reads as chrome, not as a debug control, and every line below is that
 *  one sentence. The BOX is the shell its neighbour uses
 *  ({@link CHROME_CONTROL_SHELL}) — same height, same radius, same edge — so
 *  the two are one visual family however their type differs. The TYPE is the
 *  chrome's own sans at the chrome's own weight, not the monospace the posture
 *  segments wear: those are a glyph-and-word pair where the glyph is the
 *  subject, and this is a name. The ACCENT is the conductor's hue the way a
 *  host's tab wears its host's: the mark carries it at rest, and selecting the
 *  entry fills the pill with it — the same accent tint the posture control's
 *  live segment uses, because "this is where you are" is one idea and gets one
 *  spelling. HOVER is the host tabs' wash, in that hue, for the same reason.
 *
 *  There is no separator before it. A divider would be drawing the "not a host
 *  tab" statement twice: the pill already is that statement, and the row's own
 *  gap is what ends the tabs.
 *
 *  Its badge is the violet needs-you count — the questions the one
 *  conversation is blocked on, across every host it has terminals on. It sits
 *  on the pill's top-right CORNER rather than inline, so the pill's width does
 *  not move when a question arrives. ABSENT at zero, never a `0`: a badge that
 *  renders its own silence is one every reader has to parse before ignoring.
 *
 *  The `beta` tag is INLINE, and that is the opposite choice for the opposite
 *  reason. The corner is taken, and two things stacked there would overlap on
 *  the one press that matters. More to the point the tag is a constant — it is
 *  true of the feature, not of the moment — so it is part of the pill's width
 *  from the first paint and never moves the row, which is exactly what the
 *  badge could not promise. */

import { type Component, Show } from "solid-js";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import { CHROME_CONTROL_SHELL } from "./chromeControl";
import { conductorAsksTotal } from "./useConductorFacts";
import {
  enterConductorMode,
  exitConductorMode,
  conductorMode,
} from "./useConductorMode";

const ConductorTab: Component = () => (
  <Tip label={`Conductor (${formatKeybind(ACTIONS.toggleConductor.keybind)})`}>
    <button
      type="button"
      data-testid="conductor-tab"
      data-active={conductorMode() ? "" : undefined}
      aria-pressed={conductorMode()}
      class={`${CHROME_CONTROL_SHELL} conductor-tab pointer-events-auto relative flex items-center gap-1.5 px-2.5 text-[0.78rem] font-medium leading-none cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50`}
      classList={{
        "border-accent/60 bg-accent/12 text-accent": conductorMode(),
        "text-fg-2 hover:text-fg": !conductorMode(),
      }}
      onClick={() =>
        conductorMode() ? exitConductorMode() : enterConductorMode()
      }
    >
      {/* The MARK carries the hue at rest, which is how a host tab wears its
          host's: colour says which destination this is before the word is
          read. Selected, the pill is accent throughout and the mark simply
          inherits it. */}
      <span aria-hidden="true" classList={{ "text-accent": !conductorMode() }}>
        ◆
      </span>
      Conductor
      <span
        data-testid="conductor-beta"
        class="rounded-sm bg-fg-3/15 px-1 py-px font-mono text-[0.58rem] font-semibold uppercase tracking-[0.08em] leading-[1.4] text-fg-3"
      >
        beta
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
