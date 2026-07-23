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
  let variant = pipVariant(bucket);
  // Live plain shell paints as working (busy orange) so StatePip needs no
  // shell-special paint branch — activity still drives motion via `active`.
  if (!agent && input.isLive && variant === "idle") {
    variant = "working";
  }
  const active = pipIsActive({
    agent,
    isLive: input.isLive,
    isFinished: input.isFinished,
  });
  const motion = pipMotionKind({ variant, agent, active });
  return {
    variant,
    glyph: pipGlyphFor(input.meta),
    motion,
    active,
    bytesLive: input.isLive,
    alert: input.unread,
    alertLabel: "unread alert",
  };
}
