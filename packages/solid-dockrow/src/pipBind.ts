import {
  activeArm,
  sleepingArm,
  type TerminalMetadata,
} from "@kolu/padi-client/vocab";
import type {
  PipGlyphId,
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import {
  isPipGlyphId,
  pipForPaintClass,
} from "@kolu/solid-statepip/pipVariant";
import {
  type AgentPaintClass,
  type AttentionClass,
  paintClassOf,
} from "@kolu/terminal-vocab/agentProjection";
import { isActive, type TerminalAttention } from "@kolu/padi-client/attention";

export type DockRowBucket = AgentPaintClass | "idle" | "sleeping" | "parked";

/** Values the PAINT fold can actually emit. A classless row paints `idle`. */
export type DockPaintBucket = Exclude<DockRowBucket, "none">;

/** What a surface with no activity window of its own can get back: a row it
 *  never parks cannot paint `parked`. The overloads below carry that narrowing,
 *  so a caller that passes no `parked` argument (or a literal `false`) does not
 *  have to re-widen its own row type to admit a bucket it cannot reach. */
export type UnparkedPaintBucket = Exclude<DockPaintBucket, "parked">;

export function dockOverlayBucket(
  meta: TerminalMetadata,
  parked: boolean,
): "parked" | "sleeping" | undefined {
  if (parked) return "parked";
  if (sleepingArm(meta)) return "sleeping";
  return undefined;
}

export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
): UnparkedPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: false,
): UnparkedPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked: boolean,
): DockPaintBucket;
export function paintDockRow(
  meta: TerminalMetadata,
  klass: AttentionClass,
  parked = false,
): DockPaintBucket {
  const overlay = dockOverlayBucket(meta, parked);
  if (overlay) return overlay;
  const paint = paintClassOf(klass);
  return paint === "none" ? FALLBACK_PAINT_BUCKET : paint;
}

const FALLBACK_PAINT_BUCKET: DockPaintBucket = "idle";

export const FALLBACK_ORDER_BUCKET: DockRowBucket = "idle";

export function pipVariant(bucket: DockRowBucket): PipVariant {
  switch (bucket) {
    case "awaiting":
    case "linger":
    case "working":
    case "none":
      return pipForPaintClass(bucket);
    case "idle":
      return "idle";
    case "sleeping":
      return "sleeping";
    case "parked":
      return "empty";
  }
}

export const FALLBACK_PIP_GLYPH: PipGlyphId = "shell";

export const FALLBACK_PIP_VARIANT: PipVariant = pipVariant(
  FALLBACK_PAINT_BUCKET,
);

export function hasAgentOf(meta: TerminalMetadata): boolean {
  return Boolean(activeArm(meta)?.agent);
}

/** Identity glyph for a row/title pip — live agent kind, else the persisted
 *  resume identity on a sleeping (or just-quit) terminal, else the shell
 *  prompt. One place every StatePip call site reads "who is driving this". */
export function pipGlyphFor(meta: TerminalMetadata): PipGlyphId {
  const live = activeArm(meta)?.agent?.kind;
  if (live) return live;
  const target = meta.restoreTarget;
  if (target?.kind === "exact" && isPipGlyphId(target.agent.kind))
    return target.agent.kind;
  return FALLBACK_PIP_GLYPH;
}

export function pipMotionKind(input: {
  variant: PipVariant;
  active: boolean;
}): PipMotionKind {
  if (
    input.variant === "empty" ||
    input.variant === "sleeping" ||
    !input.active
  ) {
    return "none";
  }
  return input.variant === "awaiting" ? "glow" : "spin";
}

export function pipShellLive(input: {
  variant: PipVariant;
  hasAgent: boolean;
  bytesLive: boolean;
}): boolean {
  return !input.hasAgent && input.bytesLive && input.variant === "idle";
}

/** The pip facts a producer holds — everything the bag carries that is not a
 *  total function of the rest. This is the half that crosses a wire. */
export type StatePipFacts = {
  variant: PipVariant;
  glyph: PipGlyphId;
  /** Effectively active — recency hide, `data-active`. Not raw PTY bytes. */
  active: boolean;
  asking: boolean;
  /** Raw meaningful output — a11y "live output" only. */
  bytesLive: boolean;
  /** Dormant terminal — row/title recede (same token everywhere). */
  sleeping: boolean;
  alert: boolean;
  alertLabel: string;
};

/** The members folded FROM {@link StatePipFacts} and `hasAgent`. A member
 *  belongs here exactly when it is a total function of the others, and a member
 *  here never crosses a wire: `WireRowVocab` is built off the facts half, and
 *  {@link DERIVED_PIP_KEYS} strips these at the boundary. */
export type StatePipDerived = {
  motion: PipMotionKind;
  /** Quiet shell with live PTY bytes → busy orange without agent "Working". */
  shellLive: boolean;
};

/** Fenced key set for {@link StatePipDerived} — a third derived member stops
 *  this compiling rather than slipping onto the wire. */
export const DERIVED_PIP_KEYS: Record<keyof StatePipDerived, true> = {
  motion: true,
  shellLive: true,
};

/** The bound `StatePip` prop bag — identity · paint · motion · activity ·
 *  unread · dormancy folded once so call sites cannot drift. */
export type StatePipBind = StatePipFacts & StatePipDerived;

export function bindStatePip(input: {
  meta: TerminalMetadata;
  attention: TerminalAttention;
  unread: boolean;
  /** A surface that already computed the paint bucket (the dock, off its own
   *  ranking pass over this same class) hands it in; every other surface omits
   *  it and this folds the class itself. */
  pipBucket?: DockRowBucket;
}): StatePipBind {
  const bucket =
    input.pipBucket ?? paintDockRow(input.meta, input.attention.klass);
  const variant = pipVariant(bucket);
  const active = isActive(input.attention);
  const motion = pipMotionKind({ variant, active });
  const shellLive = pipShellLive({
    variant,
    hasAgent: hasAgentOf(input.meta),
    bytesLive: input.attention.live,
  });
  return {
    variant,
    glyph: pipGlyphFor(input.meta),
    motion,
    active,
    asking: input.attention.klass === "asking",
    bytesLive: input.attention.live,
    shellLive,
    sleeping: sleepingArm(input.meta) !== undefined,
    alert: input.unread,
    alertLabel: "unread alert",
  };
}
