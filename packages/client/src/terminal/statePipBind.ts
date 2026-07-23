/** One binder + memoized hook for every StatePip surface — dock, list, title,
 *  workspace card, rail. Folds identity · paint · motion · activity · unread ·
 *  dormancy into a prop bag so call sites cannot drift. */

import {
  activeArm,
  sleepingArm,
  type TerminalMetadata,
} from "@kolu/padi/surface";
import type {
  PipGlyphId,
  PipMotionKind,
  PipVariant,
} from "@kolu/solid-statepip/pipVariant";
import type { TerminalId } from "kolu-common/surface";
import { createMemo, type Accessor } from "solid-js";
import {
  type DockRowBucket,
  paintDockRow,
} from "../canvas/dock/dockRowRanking";
import { pipGlyphFor, pipVariant } from "../canvas/dock/pipVariant";
import { pipIsActive, pipMotionKind } from "./pipMotion";
import { useFinishedQuiet } from "./useFinishedQuiet";
import { useTerminalActivity } from "./useTerminalActivity";

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
  /** Dormant terminal — row/title recede (same token everywhere). */
  sleeping: boolean;
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
}): StatePipBind {
  const agent = activeArm(input.meta)?.agent;
  const bucket = input.pipBucket ?? paintDockRow(input.meta);
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
    sleeping: sleepingArm(input.meta) !== undefined,
    alert: input.unread,
    alertLabel: "unread alert",
  };
}

/** Memoized binder for a reactive terminal row — owns activity + EF2 reads so
 *  call sites do not re-run the fold once per JSX prop. */
export function useStatePip(
  id: Accessor<TerminalId>,
  meta: Accessor<TerminalMetadata>,
  unread: Accessor<boolean>,
  pipBucket?: Accessor<DockRowBucket | undefined>,
): Accessor<StatePipBind> {
  const activity = useTerminalActivity();
  const finishedQuiet = useFinishedQuiet();
  return createMemo(() =>
    bindStatePip({
      meta: meta(),
      isLive: activity.isLive(id()),
      isFinished: finishedQuiet.isFinished(id()),
      unread: unread(),
      pipBucket: pipBucket?.(),
    }),
  );
}
