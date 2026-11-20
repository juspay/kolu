import type { AgentPaintClass } from "@kolu/terminal-vocab/agentProjection";
import { type AgentKind, mapAgentVocabs } from "kolu-agents/vocab";

export type PipVariant =
  | "awaiting" // blocked on you (`awaiting_user`)
  | "linger" // post-turn lull (`waiting`)
  | "working" // busy
  | "idle" // muted shell / none-agent
  | "sleeping" // dormant
  | "empty"; // parked / none — renders nothing

export type PipGlyphId = AgentKind | "shell";

/** The shared agent-paint → pip fold. `none` (no agent paint) renders nothing:
 *  a surface that wants a muted mark for a touched-but-agentless terminal maps
 *  that case itself. */
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

export type PipGlyphDef = {
  viewBox: string;
  paint: "fill" | "stroke";
  paths: readonly string[];
  strokeWidth?: number;
};

const bar = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y}h${w}v${h}h-${w}z`;

const GLYPH_SHELL: PipGlyphDef = {
  viewBox: "0 0 24 24",
  paint: "fill",
  paths: [
    bar(7.5, 3.5, 3, 17),
    bar(13.5, 3.5, 3, 17),
    bar(4, 8, 16, 3),
    bar(4, 13, 16, 3),
  ],
};

const PIP_GLYPHS: Record<PipGlyphId, PipGlyphDef> = {
  ...mapAgentVocabs((vocab) => vocab.mark),
  shell: GLYPH_SHELL,
};

export function agentGlyph(kind: AgentKind): PipGlyphDef {
  return PIP_GLYPHS[kind];
}

export function pipGlyph(id: PipGlyphId): PipGlyphDef {
  return PIP_GLYPHS[id];
}

export type PipBody = { class: string };

export type PipMotionKind = "spin" | "glow" | "none";

export const PIP_MOTION_CLASS: Record<PipMotionKind, string | null> = {
  spin: "statepip-anim-spin motion-reduce:animate-none",
  glow: "statepip-anim-glow motion-reduce:animate-none statepip-awaiting-core",
  none: null,
};

export const AWAITING_LINGER_CLASS = "text-alert/55";

export const PIP_BODY = {
  awaiting: { class: "text-alert" },
  linger: { class: AWAITING_LINGER_CLASS },
  working: { class: "text-busy" },
  idle: { class: "text-fg-3" },
  sleeping: { class: "text-moonlit/65" },
  empty: null,
} satisfies Record<PipVariant, PipBody | null>;

export const SHELL_LIVE_CLASS = PIP_BODY.working.class;

export const PIP_TITLES: Record<PipVariant, string> = {
  awaiting: "Awaiting your input",
  linger: "Turn finished",
  working: "Working",
  idle: "Idle",
  sleeping: "Sleeping",
  empty: "",
};

export const INDICATOR_BASE =
  "relative inline-flex flex-none items-center justify-center";

export const DOCK_ROW_PIP_BOX = "w-[20px] h-[20px] rounded-full";

export const TITLE_PIP_BOX = "w-[16px] h-[16px] rounded-full";

export const ACTIVE_COUNT_CLASS =
  "inline-flex items-center gap-0.5 text-[10px] font-semibold text-busy tabular-nums";

export const NEEDS_YOU_PILL_CLASS =
  "inline-flex items-center justify-center rounded-full bg-alert/90 text-[10px] font-semibold text-black/80 tabular-nums";

export const UNSEEN_COUNT_CLASS =
  "inline-flex items-center justify-center rounded-full bg-attention text-[10px] font-semibold text-surface-0 tabular-nums";

export const ALERT_BADGE_CLASS = "statepip-alert-badge";

export const GLYPH_SVG_CLASS = "block w-[16px] h-[16px]";

export const SLEEPING_RECEDE_CLASS = "opacity-55";

export const PIP_VARIANTS = Object.keys(PIP_BODY) as readonly PipVariant[];

export const PIP_MOTION_KINDS = Object.keys(
  PIP_MOTION_CLASS,
) as readonly PipMotionKind[];

export const PIP_GLYPH_IDS = Object.keys(PIP_GLYPHS) as readonly PipGlyphId[];

const isKeyOf =
  <K extends string>(record: Record<K, unknown>) =>
  (raw: string): raw is K =>
    Object.hasOwn(record, raw);

export const isPipVariant = isKeyOf(PIP_BODY);

export const isPipMotionKind = isKeyOf(PIP_MOTION_CLASS);

export const isPipGlyphId = isKeyOf(PIP_GLYPHS);
