import type { AgentPaintClass } from "@kolu/terminal-vocab/agentProjection";
import { type AgentKind, mapAgentVocabs } from "kolu-agents/vocab";

export type PipVariant =
  | "awaiting" // blocked on you (`awaiting_user`): full needs-you violet + glow
  | "linger" // post-turn lull (`waiting`): quiet dim violet
  | "working" // busy orange + spin
  | "idle" // muted shell / none-agent
  | "sleeping" // dormant: moonlit paint + still
  | "empty"; // parked / none — render nothing

/** Who is driving the terminal — an agent kind, or the plain shell. */
export type PipGlyphId = AgentKind | "shell";

/** The shared agent-paint → pip fold. Speaks only the three agent paint classes
 *  (`@kolu/terminal-vocab/agentProjection`'s `AgentPaintClass`): `none` (no
 *  agent paint) renders nothing — a surface that wants a muted mark for a
 *  touched-but-agentless terminal maps that case itself (the Dock's `idle`,
 *  a fleet mirror's nonagent), it does not belong to the agent-paint vocabulary.
 *  Exhaustive with a `satisfies never` fence so a new paint class forces a pip
 *  decision HERE, in the one shared definition. */
export function pipForPaintClass(paint: AgentPaintClass): PipVariant {
  switch (paint) {
    case "working":
      return "working";
    case "awaiting":
      return "awaiting";
    case "linger":
      return "linger";
    case "none":
      return "empty";
    default:
      paint satisfies never;
      return "empty";
  }
}

/** A brand mark or shell prompt — one render shape for both fill and stroke. */
export type PipGlyphDef = {
  viewBox: string;
  /** `fill` for brand marks and the shell `#`; `stroke` unused today. */
  paint: "fill" | "stroke";
  paths: readonly string[];
  /** Stroke width when `paint === "stroke"`. */
  strokeWidth?: number;
};

const GLYPH_SHELL: PipGlyphDef = {
  viewBox: "0 0 24 24",
  paint: "fill",
  paths: [
    "M7.5 3.5h3v17h-3z",
    "M13.5 3.5h3v17h-3z",
    "M4 8h16v3H4z",
    "M4 13h16v3H4z",
  ],
};

const PIP_GLYPHS: Record<PipGlyphId, PipGlyphDef> = {
  ...mapAgentVocabs((vocab) => vocab.mark),
  shell: GLYPH_SHELL,
};

/** Agent-kind → brand mark. */
export function agentGlyph(kind: AgentKind): PipGlyphDef {
  return PIP_GLYPHS[kind];
}

/** Identity glyph for a pip core — agent brand or shell prompt. */
export function pipGlyph(id: PipGlyphId): PipGlyphDef {
  return PIP_GLYPHS[id];
}

/** The rendered LOOK for each variant — Tailwind colour + motion class tokens
 *  applied to the identity glyph. Shape is the glyph (`pipGlyph`); this record
 *  is only paint × motion. `null` is a variant that renders nothing inside the
 *  cell (`empty`). Colours are `@kolu/theme` tokens so every surface resolves
 *  them identically; motion classes live in `statepip.css` and carry
 *  reduced-motion safety there. */
export type PipBody = { class: string };

/** Motion channel kinds — activity drives which runs. Callers pick via the pure
 *  dock `pipMotionKind` fold (working→spin, awaiting_user→glow, waiting→
 *  spin until EF2 quiet, shell→spin while live). */
export type PipMotionKind = "spin" | "glow" | "none";

/** CSS class tokens per motion kind. `none` is null (still). Glow carries the
 *  reduced-motion awaiting hollow-outline class so needs-you never degrades to
 *  colour alone under prefers-reduced-motion. */
export const PIP_MOTION_CLASS: Record<PipMotionKind, string | null> = {
  spin: "statepip-anim-spin motion-reduce:animate-none",
  glow: "statepip-anim-glow motion-reduce:animate-none statepip-awaiting-core",
  none: null,
};

/** Post-turn linger violet — pip `linger` paint and AgentIndicator `waiting`. */
export const AWAITING_LINGER_CLASS = "text-alert/55";

export const PIP_BODY: Record<PipVariant, PipBody | null> = {
  awaiting: { class: "text-alert" },
  linger: { class: AWAITING_LINGER_CLASS },
  working: { class: "text-busy" },
  idle: { class: "text-fg-3" },
  sleeping: { class: "text-moonlit/65" },
  empty: null,
};

/** Live plain-shell paint — alias of working busy orange (binder sets shellLive). */
export const SHELL_LIVE_CLASS = PIP_BODY.working!.class;

/** The hover-title for each variant (a11y/affordance). */
export const PIP_TITLES: Record<PipVariant, string> = {
  awaiting: "Awaiting your input",
  linger: "Turn finished",
  working: "Working",
  idle: "Idle",
  sleeping: "Sleeping",
  empty: "",
};

/** The merged status indicator's leaf-intrinsic WRAPPER class — content-sized
 *  (no fixed box), positioning context for the amber alert badge (absolute in
 *  `statepip.css`); `flex-none` so it never stretches beside flexed siblings.
 *  Surfaces that reserve a column pass `DOCK_ROW_PIP_BOX` / `TITLE_PIP_BOX`. */
export const INDICATOR_BASE =
  "relative inline-flex flex-none items-center justify-center";

/** The dock-row / fleet-row pip BOX — the fixed 20 px circle a surface that
 *  reserves a column passes to `StatePip` via its `class` prop. 20 px matches the
 *  `DOCK_ROW_GRID` leading track, so the indicator never shifts as the axes flip
 *  and an axis-less pip is an invisible box that still reserves the column. It
 *  is a CALLER's geometry, not the leaf's — non-row callers (the tile title, the
 *  workspace column header) pass nothing and get an intrinsically-sized pip. */
export const DOCK_ROW_PIP_BOX = "w-[20px] h-[20px] rounded-full";

/** The tile-title pip BOX — a smaller fixed circle the canvas title bar passes to
 *  `StatePip`. The title pip carries the `alert` BADGE (the row's `unread`), and
 *  the badge anchors to the wrapper's top-right corner; a reserved 16 px box
 *  gives the 16 px glyph + corner badge room. Caller's geometry, same as
 *  `DOCK_ROW_PIP_BOX`. */
export const TITLE_PIP_BOX = "w-[16px] h-[16px] rounded-full";

/** ACTIVE count — agents in flight, agents still settling after a turn, and
 *  shells that are printing. Named `active`, not `working`: the leg
 *  deliberately counts more than working agents.
 *
 *  Bare rust text beside a small spinner, deliberately NOT a capsule: the
 *  capsule silhouette is reserved for the two ACTIONABLE counts (needs-you
 *  violet, unread amber) so a number in a pill always means "click me / act on
 *  this" and a bare number never reads as a notification. Same hue family as
 *  the working pip (`text-busy`). */
export const ACTIVE_COUNT_CLASS =
  "inline-flex items-center gap-0.5 text-[10px] font-semibold text-busy tabular-nums";

/** Needs-you / awaiting-you count pill — agents blocked on your input
 *  (`awaiting_user`). Cool violet (`bg-alert`), same family as StatePip
 *  awaiting paint/glow. Host tab (`AttentionTriplet`) uses THIS.
 *
 *  Distinct from unread (amber):
 *    · needs-you  → violet  (state: blocked on you; host pill; pip glow)
 *    · unread     → amber   (obligation: unopened; corner badge; finished-unseen) */
export const NEEDS_YOU_PILL_CLASS =
  "inline-flex items-center justify-center rounded-full bg-alert/90 text-[10px] font-semibold text-black/80 tabular-nums";

/** Host-tab finished-unseen COUNT pill — solid amber (`--color-attention`),
 *  same obligation hue as `ALERT_BADGE_CLASS`. Geometry mirrors
 *  `NEEDS_YOU_PILL_CLASS` so the two host-tab marks read as one vocabulary
 *  split by hue, not by shape: violet = blocked on you, amber = finished and
 *  unopened. Solid fill + a real number, never a half-alpha dot. */
export const UNSEEN_COUNT_CLASS =
  "inline-flex items-center justify-center rounded-full bg-attention text-[10px] font-semibold text-surface-0 tabular-nums";

/** Unread / obligation CORNER DOT on StatePip (top-right). Warm amber
 *  (`--color-attention`) — deliberately a different hue from needs-you
 *  violet so "state is awaiting" and "you have an unopened notification"
 *  never collapse into one mark. The host tab's finished-unseen mark
 *  (`AttentionTriplet`) uses `UNSEEN_COUNT_CLASS`. */
export const ALERT_BADGE_CLASS = "statepip-alert-badge";

/** Glyph size inside the 20 px dock pip box — 16 px mark, 2 px inset each side. */
export const GLYPH_SVG_CLASS = "block w-[16px] h-[16px]";

/** Dormancy's caller-side treatment — the opacity a sleeping terminal's ROW or
 *  TITLE recedes to, applied by the caller beside the `sleeping` pip it pairs
 *  with: the pip paints moonlit, the surface AROUND it fades, and the two must
 *  agree. The dock row (`@kolu/solid-dockrow`) and kolu's tile title read ONE
 *  token, so a retune cannot reach one and miss the other. */
export const SLEEPING_RECEDE_CLASS = "opacity-55";

/** Every `PipVariant`, from the paint record that already fences the union. */
export const PIP_VARIANTS = Object.keys(PIP_BODY) as readonly PipVariant[];

/** Every `PipMotionKind`, from the motion-class record. */
export const PIP_MOTION_KINDS = Object.keys(
  PIP_MOTION_CLASS,
) as readonly PipMotionKind[];

/** Every `PipGlyphId` — the five agent brands and the shell. */
export const PIP_GLYPH_IDS = Object.keys(PIP_GLYPHS) as readonly PipGlyphId[];

/** Is this string a pip variant?
 *
 *  `Object.hasOwn`, never `in`: `in` walks the prototype chain, so a wire word
 *  of `"toString"` or `"constructor"` would narrow as a member of a set it is
 *  not in — and then index the record to `undefined` at render time. A guard
 *  that lies about its own vocabulary is worse than no guard. */
export function isPipVariant(raw: string): raw is PipVariant {
  return Object.hasOwn(PIP_BODY, raw);
}

/** Is this string a motion kind? */
export function isPipMotionKind(raw: string): raw is PipMotionKind {
  return Object.hasOwn(PIP_MOTION_CLASS, raw);
}

/** Is this string an identity glyph id? */
export function isPipGlyphId(raw: string): raw is PipGlyphId {
  return Object.hasOwn(PIP_GLYPHS, raw);
}
