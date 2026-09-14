/** The status-pip vocabulary + the shared agent-paint → pip fold + the two
 *  outer-layer folds the merged status indicator wraps around the core.
 *
 *  A `PipVariant` is the agent-state CORE the `StatePip` component switches
 *  over — the cross-surface vocabulary kolu's on-canvas **Dock** speaks, and
 *  any fleet mirror that adopts it (it was first shared with the now-retired
 *  **pulam-web** fleet dashboard, since dissolved into padi), so a given agent
 *  state renders the IDENTICAL pip (glyph · colour · animation) on every
 *  surface. `StatePip` lives here, in a presentation leaf every consuming
 *  surface imports, rather than in `dock/` where it used to — location is
 *  structure.
 *
 *  The core is identity glyph + state paint; **motion** is the activity channel
 *  (spin/glow, caller-supplied); the unread **alert** is an amber corner badge
 *  (`ALERT_BADGE_CLASS` in `statepip.css`). There is no live plate/ring — a disc
 *  behind the glyph read as a muddy wash on brand marks.
 *
 *  Option C: every core is an **identity glyph** ("who is driving this
 *  terminal") — a real agent brand mark, or the shell prompt for a plain
 *  terminal — painted and animated by `PipVariant`. Shape carries identity;
 *  colour + motion carry state. The glyph path record is a `satisfies never`-
 *  fenced fold over `AgentKind`, so a new agent kind compile-fails HERE.
 *
 *  `pipForPaintClass` is the single definition of "which pip an agent's paint
 *  class shows", imported by the Dock's `pipVariant` (and any fleet mirror's
 *  equivalent fold), so the agent-paint → pip mapping can't be spelled — and
 *  drift — twice (the exact "defined twice → drifts" hazard R-pip-unify closes).
 *  Each surface layers only its OWN core overlays on top: the Dock adds
 *  `parked`→empty and its deliberate `sleeping`; the retired pulam-web added
 *  structural sleeping (no agent + no foreground). No surface's local triage
 *  concepts leak in here. So the IDENTICAL-pip guarantee is precisely for
 *  **agent** states (everything the shared fold decides); the **non-agent**
 *  overlays deliberately diverge — a touched-but-idle shell paints `idle` on the
 *  Dock (folded on recency), where the retired pulam-web painted `sleeping`
 *  (folded on foreground), by design, because each surface owns what an
 *  agentless terminal means to it.
 *
 *  This module is exposed on its OWN `./pipVariant` subpath (the same shape
 *  `@kolu/solid-pierre` uses for its `./paths` reconcile fold), so the pure-logic
 *  consumers — the Dock's `pipVariant` (and any fleet mirror's `pipVariantFor`)
 *  and their unit tests — import the fold WITHOUT pulling in `StatePip` (the barrel's JSX),
 *  which a node-environment Vitest can't transform out of a workspace dependency.
 *  The rendering call sites import `StatePip` from the barrel; the two entry
 *  points are a deliberate value/JSX split, not redundancy. */

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

// ── Identity glyphs ────────────────────────────────────────────────────
// Each agent's brand mark is declared in that agent's own vocab and folded by
// the registry (see `PIP_GLYPHS` below). The shell prompt is the one non-agent
// mark, defined here.

/** Shell — filled `#` prompt.
 *
 *  Why not the alternatives:
 *    · `❯ _` chevron — lopsided, thrashing under continuous spin
 *    · terminal window frame — too close to OpenCode's filled square mark
 *  `#` is the classic root-shell prompt: near 4-fold symmetry so spin stays
 *  clean, and it cannot be confused with any agent brand (OpenCode, Claude,
 *  Codex, Grok). Filled like the brands so weight matches at 16px. */
const GLYPH_SHELL: PipGlyphDef = {
  viewBox: "0 0 24 24",
  paint: "fill",
  paths: [
    // Two verticals
    "M7.5 3.5h3v17h-3z",
    "M13.5 3.5h3v17h-3z",
    // Two horizontals (slightly offset from center for a true #, not a +)
    "M4 8h16v3H4z",
    "M4 13h16v3H4z",
  ],
};

/** Identity glyph per core — agent brand mark or the shell prompt.
 *
 *  A DERIVED `Record`: every agent's mark comes from its own vocab in the
 *  registry, so a new `AgentKind` needs no edit here at all — the record is
 *  built from `AGENT_VOCABS`, and its keys still fence the wire vocabulary
 *  (`PIP_GLYPH_IDS`) a fleet mirror narrows against. The shell is the one
 *  non-agent mark, defined here. */
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
 *  is only paint × motion, pinned by a pure test so a colour swap (e.g.
 *  `text-accent` → `text-busy`) is caught without a DOM harness. `null` is a
 *  variant that renders nothing inside the cell (`empty`). Colours are
 *  `@kolu/theme` tokens so every surface resolves them identically; motion
 *  classes live in `statepip.css` and carry reduced-motion safety there. */
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
  // Needs-you: FULL alert violet — same strength as the AgentIndicator words
  // and the host pill, never the half-alpha linger (that dimming was how an
  // agent blocked for 20 h read like background noise).
  awaiting: { class: "text-alert" },
  // lingering violet — the post-turn (`waiting`) just-finished cue only.
  linger: { class: AWAITING_LINGER_CLASS },
  // rust/orange busy — machine in flight (thinking / tools / background).
  // Deliberately NOT teal accent: accent is chrome selection, not agent work.
  working: { class: "text-busy" },
  // muted shell — live shells use SHELL_LIVE_CLASS via binder `shellLive`
  idle: { class: "text-fg-3" },
  // moonlit + still (the ☾ shape retired — moonlit paint carries sleep)
  sleeping: { class: "text-moonlit/65" },
  // parked / none — render nothing inside the cell
  empty: null,
};

/** Live plain-shell paint — alias of working busy orange (binder sets shellLive). */
export const SHELL_LIVE_CLASS = PIP_BODY.working!.class;

/** The hover-title for each variant (a11y/affordance). Pure data so it stays
 *  beside `PIP_BODY` and out of the JSX. */
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
 *  and an axis-less pip is an invisible box that still reserves the column. Lives
 *  here beside `INDICATOR_BASE` so the box and the leaf stay co-described, but it
 *  is a CALLER's geometry, not the leaf's — non-row callers (the tile title, the
 *  workspace column header) pass nothing and get an intrinsically-sized pip. */
export const DOCK_ROW_PIP_BOX = "w-[20px] h-[20px] rounded-full";

/** The tile-title pip BOX — a smaller fixed circle the canvas title bar passes to
 *  `StatePip`. The title pip carries the `alert` BADGE (the row's `unread`), and
 *  the badge anchors to the wrapper's top-right corner; a content-sized wrapper
 *  for a 6 px core would pin that 6 px badge ON the core and bury it. A reserved
 *  16 px box gives the 16 px glyph + corner badge room — sized to the title
 *  chrome rather than the taller dock-row track. Caller's geometry, same as
 *  `DOCK_ROW_PIP_BOX`. */
export const TITLE_PIP_BOX = "w-[16px] h-[16px] rounded-full";

/** ACTIVE count — agents in flight, agents still settling after a turn, and
 *  shells that are printing. Named `active`, not `working`: the leg
 *  deliberately counts more than working agents, and calling it `working` in
 *  the class, the test id and the prose re-taught the old narrower concept at
 *  every one of those sites — the first person to "fix the working count, it
 *  includes shells" would have been fixing the name into the behaviour.
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
 *  unopened.
 *
 *  It was a 6 px `bg-attention/50` dot until #1990 — a half-alpha dot sat
 *  quieter than the 8 px connection dot two elements to its left, so the mark
 *  meant to summon you was the faintest thing on the tab. Solid fill + a real
 *  number; the tab's own amber wash (`.host-tab[data-unseen]`) carries the
 *  glance-distance signal that a dot of any size cannot. */
export const UNSEEN_COUNT_CLASS =
  "inline-flex items-center justify-center rounded-full bg-attention text-[10px] font-semibold text-surface-0 tabular-nums";

/** Unread / obligation CORNER DOT on StatePip (top-right). Warm amber
 *  (`--color-attention`) — deliberately a different hue from needs-you
 *  violet so "state is awaiting" and "you have an unopened notification"
 *  never collapse into one mark. The host tab's finished-unseen mark
 *  (`AttentionTriplet`) uses `UNSEEN_COUNT_CLASS`. */
export const ALERT_BADGE_CLASS = "statepip-alert-badge";

/** Glyph size inside the 20 px dock pip box — 16 px mark, 2 px inset each side.
 *  Reads at a glance next to dock row text (14 px was a touch shy). */
export const GLYPH_SVG_CLASS = "block w-[16px] h-[16px]";

/** Dormancy's caller-side treatment — the opacity a sleeping terminal's ROW or
 *  TITLE recedes to, applied by the caller beside the `sleeping` pip it pairs
 *  with. The fourth axis of the pip contract (identity · state · activity ·
 *  obligation, then dormancy) is the one the leaf cannot render itself: the pip
 *  paints moonlit, the surface AROUND it fades, and the two must agree.
 *
 *  Here rather than in either surface for the same reason `DOCK_ROW_PIP_BOX`
 *  and `TITLE_PIP_BOX` are: it is caller geometry that belongs beside the
 *  vocabulary it completes, so the dock row (`@kolu/solid-dockrow`) and kolu's
 *  tile title read ONE token and a retune cannot reach one and miss the other.
 *
 *  Deliberately the only opacity channel the dock spends: read-vs-unread is
 *  carried by a colour wash, never by a second opacity at a neighbouring value,
 *  which would make "read" and "asleep" the same mark. */
export const SLEEPING_RECEDE_CLASS = "opacity-55";

// ── The vocabulary as VALUES — narrowing for a wire that carries it as text ──
//
// A surface that draws these marks does not always receive them typed. A fleet
// mirror's own transport deliberately carries agent state as a plain nullable
// string: importing kolu's per-agent schema graph into an outline wire spec
// would compile five agent packages into it, and the literals do not exist as
// an array anywhere upstream (they live per-agent-package and compose as a
// union). So the consumer has a string and needs one of these unions.
//
// The answer is NOT for the consumer to declare its own copy of the literals —
// that is a second closed set for one vocabulary, and two closed sets drift.
// The answer is that the vocabulary exports its own narrowing, here, beside the
// records that already fence it. Every array below is `Object.keys` of a
// `Record` keyed by the union itself, so a new member cannot slip out of the
// list: it stops the record compiling first.

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
