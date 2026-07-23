/** One binder for every StatePip surface — dock, list, title, workspace card.
 *
 *  Folds identity · paint · motion · activity · unread into a prop bag so the
 *  four call sites cannot drift (lens-debate F1 / Hickey F1). Paint uses
 *  `pipPaintBucket` (same as dock ranking); motion uses `pipMotionKind`. */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import type {
  PipGlyphId,
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import {
  type DockRowBucket,
  pipPaintBucket,
} from "../canvas/dock/dockRowRanking";
import { pipGlyphFor, pipVariant } from "../canvas/dock/pipVariant";
import { pipIsActive, pipMotionKind } from "./pipMotion";

export type StatePipBind = {
  variant: PipVariant;
  glyph: PipGlyphId;
  motion: PipMotionKind;
  /** Effectively active — recency hide, data-active. Not raw PTY bytes. */
  active: boolean;
  /** Raw meaningful output — a11y "live output" only. */
  bytesLive: boolean;
  /** Quiet shell with live PTY bytes → busy orange without agent "Working". */
  shellLive: boolean;
  alert: boolean;
  alertLabel: string;
};

/** Pure terminal facts → StatePip props. */
export function bindStatePip(input: {
  meta: TerminalMetadata;
  isLive: boolean;
  isFinished: boolean;
  unread: boolean;
  /** Dock ranking already computed the paint bucket; others omit. */
  pipBucket?: DockRowBucket;
  parked?: boolean;
}): StatePipBind {
  const agent = activeArm(input.meta)?.agent;
  const bucket =
    input.pipBucket ?? pipPaintBucket(input.meta, input.parked ?? false);
  const variant = pipVariant(bucket);
  const active = pipIsActive({
    agent,
    isLive: input.isLive,
    isFinished: input.isFinished,
  });
  const motion = pipMotionKind({ variant, agent, active });
  // Live shell keeps idle *variant* (title/a11y stay "Idle") but busy-orange
  // paint via shellLive — not agent "Working".
  const shellLive = !agent && input.isLive && variant === "idle";
  return {
    variant,
    glyph: pipGlyphFor(input.meta),
    motion,
    active,
    bytesLive: input.isLive,
    shellLive,
    alert: input.unread,
    alertLabel: "unread alert",
  };
}
