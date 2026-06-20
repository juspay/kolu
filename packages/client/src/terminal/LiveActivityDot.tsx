/** Live-output dot — a soft green pulse shown while a terminal's PTY output is
 *  actively streaming, and nothing at all when it sits static.
 *
 *  Distinct from the agent `StatePip` (which encodes agent *state* —
 *  working/awaiting): this lights for ANY terminal moving bytes — a compile,
 *  a `tail -f`, a plain non-agent shell — which is exactly the gap a glance at
 *  the dock or title bar couldn't fill before. Green (`--color-ok`) is the one
 *  state colour the agent pips don't claim (alert=violet, busy=rust,
 *  accent=blue), so the two axes never blur into one. Mirrors
 *  `ChecksIndicator`'s dot geometry so it reads as one visual family. */

import { type Component } from "solid-js";

/** Pure visual leaf: it encapsulates only the dot's geometry and always renders.
 *  The live/static GATE lives once per call site (each surface owns when to mount
 *  it) — the dock swaps the timestamp for this dot, the title bar overlays it —
 *  so the `isLive` predicate is consulted exactly once where the layout choice
 *  differs, never re-asked here. */
const LiveActivityDot: Component = () => {
  return (
    <span
      data-testid="live-activity-dot"
      // `motion-safe:` gates the pulse on `prefers-reduced-motion: no-preference`
      // so reduced-motion users get a static dot (it still reads as live — the
      // colour carries the signal, the motion only amplifies it). The named-class
      // indicators (tile aura, rail glow) reach the same end via an explicit
      // `animation: none` block in index.css; this dot is a Tailwind utility, so
      // it rides Tailwind's own reduced-motion variant rather than a bespoke class.
      class="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-ok motion-safe:animate-pulse ring-2 ring-ok/25"
      title="Live — output updating"
    />
  );
};

export default LiveActivityDot;
