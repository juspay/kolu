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
 *  The core is only ONE of three axes the indicator now folds into one glyph
 *  (R-activity-merge). The other two — terminal **liveness** (moving bytes) and
 *  an unread-notification **alert** — were each a SEPARATE dot before, defined
 *  (and drifting) per surface; they now compose here, once, as overlay elements
 *  (`LIVE_RING_CLASS`, `ALERT_BADGE_CLASS`; visuals in `statepip.css`):
 *    - the live PLATE — a faint green disc behind the identity glyph while the
 *      terminal is emitting (contained presence; no glow bleed past the pip);
 *    - the alert BADGE — a small amber `--color-attention` corner dot, the
 *      Dock's old loud `attention` pip retired: a different SHAPE from the plate
 *      so the two never compound into nested rings, and the glyph stays fully
 *      visible.
 *  Both default off, so a bare `<StatePip variant=… />` reads exactly as before.
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

import type { AgentKind } from "@kolu/terminal-vocab/schema";
import type { AgentPaintClass } from "@kolu/terminal-vocab/agentProjection";

export type PipVariant =
  | "awaiting" // awaiting, already seen: quiet dim (lingering)
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
  /** `fill` for brand marks; `stroke` for the shell chevron. */
  paint: "fill" | "stroke";
  paths: readonly string[];
  /** Stroke width when `paint === "stroke"`. */
  strokeWidth?: number;
};

// ── Identity glyph paths ────────────────────────────────────────────────
// Real brand marks — do not hand-draw approximations. Attribution per path.
// claude / opencode / openai(codex): simple-icons (CC0).
// grok: lobehub icon set (xAI/grok is NOT in simple-icons).

function fillMark(viewBox: string, d: string): PipGlyphDef {
  return { viewBox, paint: "fill", paths: [d] };
}

/** Claude Code spark — simple-icons `anthropic` / Claude mark, 24×24. */
const GLYPH_CLAUDE = fillMark(
  "0 0 24 24",
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
);

/** Grok comet — lobehub icon set (xAI/grok is not in simple-icons). */
const GLYPH_GROK = fillMark(
  "0 0 24 24",
  "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815",
);

/** Codex / OpenAI knot — simple-icons `openai`, 24×24. */
const GLYPH_CODEX = fillMark(
  "0 0 24 24",
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
);

/** OpenCode frame — simple-icons `opencode`, 24×24. */
const GLYPH_OPENCODE = fillMark(
  "0 0 24 24",
  "M22 24H2V0h20zM17 4.8H7v14.4h10z",
);

/** Shell prompt — chevron + cursor (`❯ _`), stroked so it reads at 14px. */
const GLYPH_SHELL: PipGlyphDef = {
  viewBox: "0 0 24 24",
  paint: "stroke",
  strokeWidth: 2.8,
  paths: ["M4.5 6.5 11 12l-6.5 5.5", "M13.5 18.5h6"],
};

/** Agent-kind → brand mark. Exhaustive over `AgentKind` so a new kind forces
 *  a glyph decision here — never a silent shell fallback. */
export function agentGlyph(kind: AgentKind): PipGlyphDef {
  switch (kind) {
    case "claude-code":
      return GLYPH_CLAUDE;
    case "codex":
      return GLYPH_CODEX;
    case "opencode":
      return GLYPH_OPENCODE;
    case "grok":
      return GLYPH_GROK;
    default:
      kind satisfies never;
      return GLYPH_SHELL;
  }
}

/** Identity glyph for a pip core — agent brand or shell prompt. */
export function pipGlyph(id: PipGlyphId): PipGlyphDef {
  if (id === "shell") return GLYPH_SHELL;
  return agentGlyph(id);
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

export const PIP_BODY: Record<PipVariant, PipBody | null> = {
  // lingering violet-55% — post-turn (`waiting`) and `awaiting_user` share this
  // paint via agentPaintClass. Needs-you is still the full violet channel via
  // glow motion + host pill; AgentIndicator mirrors /55 for `waiting` and full
  // `text-alert` for `awaiting_user`.
  awaiting: { class: "text-alert/55" },
  // rust/orange busy — machine in flight (thinking / tools / background).
  // Deliberately NOT teal accent: accent is chrome selection, not agent work.
  working: { class: "text-busy" },
  // muted shell — live shells brighten via StatePip → SHELL_LIVE_CLASS
  idle: { class: "text-fg-3" },
  // moonlit + still (the ☾ shape retired — moonlit paint carries sleep)
  sleeping: { class: "text-moonlit/65" },
  // parked / none — render nothing inside the cell
  empty: null,
};

/** Shell with meaningful live output (btop, builds, tail -f) — same busy
 *  orange as a working agent so activity reads one colour everywhere.
 *
 *  One shell tier only: quiet → `text-fg-3` (idle body); active/live → this
 *  class. There is no mid tier for "foreground process present" — the
 *  process name already sits on the sub-line in words. */
export const SHELL_LIVE_CLASS = "text-busy";

/** The hover-title for each variant (a11y/affordance). Pure data so it stays
 *  beside `PIP_BODY` and out of the JSX. */
export const PIP_TITLES: Record<PipVariant, string> = {
  awaiting: "Awaiting input",
  working: "Working",
  idle: "Idle",
  sleeping: "Sleeping",
  empty: "",
};

/** The merged status indicator's leaf-intrinsic WRAPPER class — content-sized
 *  (no fixed box, so it fits whatever text/gap context the surface drops it in),
 *  and the positioning context for the two outer-axis overlays (R-activity-merge).
 *  `relative` so the live ring + alert badge (absolutely positioned, see
 *  `@kolu/solid-statepip/statepip.css`) anchor to it; `flex-none` so it never
 *  stretches or shrinks beside flexed siblings. A surface that reserves a
 *  fixed-size column passes that box in via `StatePip`'s `class` prop (the dock
 *  rows / fleet rows use `DOCK_ROW_PIP_BOX`); the leaf itself owns no surface
 *  geometry. */
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

/** Needs-you / awaiting-you count pill — agents blocked on your input
 *  (`awaiting_user`). Cool violet (`bg-alert`), same family as StatePip
 *  awaiting paint/glow. Host tab (`HostAwaitingPill`) uses THIS.
 *
 *  Distinct from unread (amber):
 *    · needs-you  → violet  (state: blocked on you; host pill; pip glow)
 *    · unread     → amber   (obligation: unopened; corner badge; finished-unseen) */
export const NEEDS_YOU_PILL_CLASS =
  "inline-flex items-center justify-center rounded-full bg-alert/90 text-[10px] font-semibold text-black/80 tabular-nums";

/** Alias — same violet needs-you pill (name prefers "awaiting" vocabulary). */
export const AWAITING_PILL_CLASS = NEEDS_YOU_PILL_CLASS;

/** Unread / obligation FILL for pill-shaped chrome (workspace-card corner ping).
 *  Warm amber — same hue family as `ALERT_BADGE_CLASS` / HostFinishedDot.
 *  NEVER use this for needs-you (that is `NEEDS_YOU_PILL_CLASS` / violet). */
export const UNREAD_PILL_CLASS =
  "inline-flex items-center justify-center rounded-full bg-attention/90 text-[10px] font-semibold text-black/80 tabular-nums";

/** Unread / obligation CORNER DOT on StatePip (top-right). Warm amber
 *  (`--color-attention`) — deliberately a different hue from needs-you
 *  violet so "state is awaiting" and "you have an unopened notification"
 *  never collapse into one mark. Host tab's quieter finished-unseen mark
 *  (`HostFinishedDot`) is the same amber family, softer. */
export const ALERT_BADGE_CLASS = "statepip-alert-badge";

/** Glyph size inside the 20 px dock pip box — 16 px mark, 2 px inset each side.
 *  Reads at a glance next to dock row text (14 px was a touch shy). */
export const GLYPH_SVG_CLASS = "block w-[16px] h-[16px]";
