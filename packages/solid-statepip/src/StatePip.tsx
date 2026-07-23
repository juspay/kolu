/** The shared status indicator — identity glyph + state paint + motion + alert.
 *
 *  Axes (Option C + motion-as-activity):
 *    - `glyph` — identity (who is driving)
 *    - `variant` — paint (agent state colour)
 *    - `motion` — activity channel (spin / glow / none)
 *    - `bytesLive` — raw PTY meaningful output (a11y only)
 *    - `shellLive` — binder-computed: busy-orange shell paint (leaf trusts it)
 *    - `alert` — unread obligation badge (amber)
 *
 *  Callers should use `useStatePip` / `bindStatePip` so surfaces cannot drift. */

import { type Component, createMemo, For, Show } from "solid-js";
import {
  ALERT_BADGE_CLASS,
  GLYPH_SVG_CLASS,
  INDICATOR_BASE,
  PIP_BODY,
  PIP_MOTION_CLASS,
  PIP_TITLES,
  type PipGlyphDef,
  type PipGlyphId,
  type PipMotionKind,
  type PipVariant,
  SHELL_LIVE_CLASS,
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
   *  to shell. */
  glyph?: PipGlyphId;
  /** Activity motion channel. Default `"none"` (still). */
  motion?: PipMotionKind;
  /** Raw meaningful PTY output — a11y "live output" only (not effective-active). */
  bytesLive?: boolean;
  /** Live shell paint — binder already decided; leaf trusts the boolean. */
  shellLive?: boolean;
  /** Unread obligation corner badge (amber). Needs-you is paint/glow, not this. */
  alert?: boolean;
  alertLabel?: string;
  class?: string;
}> = (props) => {
  const variant = createMemo(() => props.variant);
  const glyphId = createMemo((): PipGlyphId => props.glyph ?? "shell");
  const body = createMemo(() => PIP_BODY[variant()]);
  const def = createMemo(() => pipGlyph(glyphId()));
  const motionKind = createMemo((): PipMotionKind => props.motion ?? "none");
  const label = createMemo(() => {
    const parts = [
      PIP_TITLES[variant()],
      props.bytesLive && "live output",
      props.alert && (props.alertLabel ?? "alert"),
    ].filter((p): p is string => Boolean(p));
    return parts.join(" · ");
  });
  const coreClass = createMemo(() => {
    const b = body();
    if (!b) return null;
    const paint = props.shellLive ? SHELL_LIVE_CLASS : b.class;
    const motion = PIP_MOTION_CLASS[motionKind()];
    return motion ? `${paint} ${motion}` : paint;
  });
  return (
    <span
      class={props.class ? `${INDICATOR_BASE} ${props.class}` : INDICATOR_BASE}
      data-testid="state-pip"
      data-pip={variant()}
      data-glyph={glyphId()}
      data-motion={motionKind()}
      data-live={props.bytesLive ? "" : undefined}
      data-alert={props.alert ? "" : undefined}
      title={label() || undefined}
      role="img"
      aria-label={label() || undefined}
      aria-hidden={label() ? undefined : "true"}
    >
      <Show when={coreClass()}>
        {(cls) => (
          <span class={`relative flex items-center justify-center ${cls()}`}>
            <GlyphSvg def={def()} />
          </span>
        )}
      </Show>
      <Show when={props.alert}>
        <span class={ALERT_BADGE_CLASS} aria-hidden="true" />
      </Show>
    </span>
  );
};
