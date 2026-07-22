/** The shared status indicator — kolu's on-canvas **Dock** renders THIS
 *  component, and it stays renderer-agnostic so any fleet mirror shows the
 *  identical glyph, colour, and animation for a given (state, live, alert,
 *  identity) tuple. (It was first extracted to share with the **pulam-web** fleet
 *  dashboard — since retired into padi at W2.3 — so the two-surface design
 *  below outlives that one consumer.)
 *
 *  Option C: the CORE is an **identity glyph** — who is driving this terminal
 *  (agent brand mark, or shell prompt). Colour + motion carry state (working
 *  breathes in accent teal; awaiting glows in lingering violet; sleeping is
 *  still moonlit). Shape no longer encodes state (the hollow-ring / ☾ era
 *  retired); under `prefers-reduced-motion` an awaiting core gains a violet
 *  hollow outline so state never degrades to colour alone.
 *
 *  Three nested axes in one glyph (R-activity-merge), so one look reads overall
 *  activity instead of scanning two or three separate dots:
 *    - `variant` (the CORE paint/motion) — agent state, the precomputed
 *      `PipVariant`. Each surface owns its own state→variant mapping (the Dock's
 *      `pipVariant`; a fleet mirror maps its own rows the same way), both folding
 *      the shared agent-paint classes through `pipForPaintClass`.
 *    - `glyph` (the CORE shape) — identity: agent kind or `"shell"`.
 *    - `live` (the PLATE) — this terminal is moving bytes right now: a faint
 *      green disc BEHIND the identity glyph (contained presence; the glyph-only
 *      rail + sub-tabs keep the standalone `LiveActivityDot` corner dot, which
 *      has no plate to sit under).
 *    - `alert` (the BADGE) — a fired notification you haven't opened (the Dock's
 *      `unread`, or a fleet mirror's notify-class): a small amber corner dot, NOT a
 *      ring — a surrounding alert ring (especially nested with the live plate)
 *      read as overwhelming, so the two axes use different shapes and never
 *      compound into concentric circles. The glyph stays fully visible.
 *
 *  Pure presentation: the per-variant CORE class set lives in `PIP_BODY`; the
 *  glyph path data in `pipGlyph` / `agentGlyph`; the plate + badge are overlay
 *  elements whose class names (`LIVE_RING_CLASS`, `ALERT_BADGE_CLASS`) and
 *  visuals live in `statepip.css`. Both surfaces `@import` that CSS, so the
 *  overlays can't drift; the class data is pinned by a pure test (no DOM harness,
 *  matching the other `@kolu/solid-*` leaves). Colours are the shared
 *  `@kolu/theme` tokens, so both surfaces resolve them identically.
 *
 *  Accessibility: the overlay spans are decoration (`aria-hidden`), so the
 *  wrapper's `title` / `aria-label` carry the meaning of ALL THREE axes — the
 *  core's `PIP_TITLES` entry plus "live output" / the per-surface `alertLabel`
 *  ("unread alert" on the Dock, "needs attention" on a fleet mirror) when those props
 *  are set — so an alerting row still announces it (the old `attention` variant's
 *  "Needs attention" affordance, now one axis over) instead of reading only its
 *  core. When there's nothing to announce (an `empty` core with no outer axes)
 *  the whole wrapper is `aria-hidden`, pulling it out of the accessibility tree —
 *  a decorative placeholder, not an unlabelled image. */

import { type Component, createMemo, For, Show } from "solid-js";
import {
  ALERT_BADGE_CLASS,
  GLYPH_SVG_CLASS,
  INDICATOR_BASE,
  LIVE_RING_CLASS,
  PIP_BODY,
  PIP_MOTION,
  PIP_TITLES,
  type PipGlyphDef,
  type PipGlyphId,
  type PipVariant,
  SHELL_BUSY_CLASS,
  pipGlyph,
} from "./pipVariant.ts";

/** Render a pip identity mark — filled brand path or stroked shell prompt. */
const GlyphSvg: Component<{ def: PipGlyphDef }> = (props) => {
  const stroked = () => props.def.paint === "stroke";
  return (
    <svg
      class={GLYPH_SVG_CLASS}
      viewBox={props.def.viewBox}
      fill={stroked() ? "none" : "currentColor"}
      stroke={stroked() ? "currentColor" : undefined}
      stroke-width={stroked() ? (props.def.strokeWidth ?? 2.8) : undefined}
      stroke-linecap={stroked() ? "round" : undefined}
      stroke-linejoin={stroked() ? "round" : undefined}
      aria-hidden="true"
    >
      <For each={props.def.paths}>{(d) => <path d={d} />}</For>
    </svg>
  );
};

export const StatePip: Component<{
  variant: PipVariant;
  /** Who is driving this terminal — agent brand mark, or `"shell"`. Defaults
   *  to shell (column headers and other non-terminal sites that only pass a
   *  state variant). Dock rows / the tile title pass the live agent kind, or
   *  the persisted identity on a sleeping row, or shell. */
  glyph?: PipGlyphId;
  /** Shell with a foreground process — brightens the idle shell mark from
   *  `fg-3` to `fg-2`. Ignored for agent glyphs. Default off. */
  busy?: boolean;
  /** Hold motion still while keeping the variant's paint — used for the post-
   *  turn `waiting` lull (lingering violet-55%, no glow) so paint and motion
   *  stay decoupled: order≠colour's paint class stays `awaiting`, motion is
   *  none. Sleeping already has no motion in `PIP_MOTION`. Default off. */
  still?: boolean;
  /** Terminal moving bytes right now → the green live-output PLATE behind the
   *  identity glyph. The activity cue, folded into the indicator. Default off. */
  live?: boolean;
  /** A fired notification not yet opened → a small amber `--color-attention`
   *  corner badge (top-right), NOT a ring, so it never compounds with the live
   *  ring into nested circles; the state core stays fully visible (the Dock's
   *  `unread`, or a fleet mirror's notify-class). Default off. */
  alert?: boolean;
  /** What the alert badge MEANS on this surface, folded into the accessible
   *  label / tooltip when `alert` is set. Different surfaces drive the badge off
   *  DIFFERENT signals, so the wording can't be baked in here: the Dock's badge
   *  is real read/unread terminal state ("unread alert"); a fleet mirror's may be
   *  live notify-class membership with no read tracking, so it says "needs attention"
   *  rather than claiming an unread it can't clear. Default the generic "alert"
   *  so a caller that sets `alert` without a label still announces something. */
  alertLabel?: string;
  /** Extra wrapper classes a surface adds on top of the content-sized leaf —
   *  e.g. the `DOCK_ROW_PIP_BOX` fixed circle the dock/fleet rows pass to reserve
   *  their column. Omitted by inline callers (the tile title, the column header),
   *  which then size to their text/gap context. */
  class?: string;
}> = (props) => {
  // Read each prop ONCE per change. Callers pass them as JSX-prop expressions
  // (`pipVariantFor(value())` / `activity.isLive(id)` / `unread()`), which Solid
  // compiles to getters re-running their fold on every access; the memos collapse
  // those to one fold per change on every consumer (carrying the original dock
  // `StatePip`'s memo forward across the lift).
  const variant = createMemo(() => props.variant);
  const glyphId = createMemo((): PipGlyphId => props.glyph ?? "shell");
  const body = createMemo(() => PIP_BODY[variant()]);
  const def = createMemo(() => pipGlyph(glyphId()));
  // The accessible label folds in ALL THREE axes, not just the core. The
  // overlay spans are aria-hidden (pure decoration), so without this an unread
  // row would read only its core ("Awaiting input") or nothing at all (an
  // `empty` core) — silently dropping the old `attention` variant's "Needs
  // attention" affordance. Compose the core title with the active outer axes so
  // the live/alert meaning survives a hover or a screen reader.
  const label = createMemo(() => {
    const parts = [
      PIP_TITLES[variant()],
      props.live && "live output",
      props.alert && (props.alertLabel ?? "alert"),
    ].filter((p): p is string => Boolean(p));
    return parts.join(" · ");
  });
  // Idle shell brightens when a foreground process is running. Motion layers
  // on top of paint unless `still` (post-turn waiting) suppresses it.
  const coreClass = createMemo(() => {
    const b = body();
    if (!b) return null;
    if (props.busy && glyphId() === "shell" && variant() === "idle") {
      return SHELL_BUSY_CLASS;
    }
    const v = variant();
    const motion =
      !props.still && v !== "empty" ? (PIP_MOTION[v] ?? null) : null;
    return motion ? `${b.class} ${motion}` : b.class;
  });
  return (
    // `data-testid="state-pip"` is the surface-neutral e2e selector for this
    // shared leaf, spanning the surfaces it renders on — the dock row pip and
    // the canvas tile-title pip (see packages/tests/step_definitions), plus any
    // fleet mirror that adopts it. `data-live`/`data-alert`/`data-glyph` expose
    // the axes for tests/inspection.
    <span
      class={props.class ? `${INDICATOR_BASE} ${props.class}` : INDICATOR_BASE}
      data-testid="state-pip"
      data-pip={variant()}
      data-glyph={glyphId()}
      data-live={props.live ? "" : undefined}
      data-alert={props.alert ? "" : undefined}
      title={label() || undefined}
      // `role="img"` so the wrapper is a single labelled graphic — `aria-label`
      // is only valid on a role that accepts a name, not a bare generic span (a
      // STATIC role here so biome's `useAriaPropsSupportedByRole` can verify the
      // pairing). When `label()` is empty — the decorative case (an `empty` core,
      // no live/alert) — `aria-hidden` pulls the whole wrapper OUT of the
      // accessibility tree, so assistive tech skips the purely-visual placeholder
      // rather than announcing an unlabelled image (`role="img"` + `aria-label=""`
      // reads as an unnamed image on some screen readers, not silently ignored).
      role="img"
      aria-label={label() || undefined}
      aria-hidden={label() ? undefined : "true"}
    >
      {/* Live plate first so it paints BEHIND the identity glyph (DOM order,
          not z-index). Alert badge last so it sits on top of both. */}
      <Show when={props.live}>
        <span class={LIVE_RING_CLASS} aria-hidden="true" />
      </Show>
      <Show when={coreClass()}>
        {(cls) => (
          <span class={`relative flex items-center justify-center ${cls()}`}>
            <GlyphSvg def={def()} />
          </span>
        )}
      </Show>
      {/* Unread attention DOT — Option C mockup's 7px corner pip. */}
      <Show when={props.alert}>
        <span class={ALERT_BADGE_CLASS} aria-hidden="true" />
      </Show>
    </span>
  );
};
