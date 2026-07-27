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
import { isActive, type TerminalAttention } from "../attention/attentionFacts";
import { useAttentionFacts } from "../attention/useAttentionFacts";
import {
  type DockRowBucket,
  paintDockRow,
} from "../canvas/dock/dockRowRanking";
import { pipGlyphFor, pipVariant } from "../canvas/dock/pipVariant";
import { pipMotionKind } from "./pipMotion";

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

/** Pure terminal facts → StatePip props.
 *
 *  `attention` arrives as ONE value from `terminalAttention` rather than as a
 *  handful of booleans each call site assembles: the ⌘K palette used to hand
 *  this function `{isLive:false,isFinished:false}` for every background host,
 *  and so every terminal on a host you weren't looking at read as idle there.
 *  With the facts arriving as a value there is nothing to fabricate. */
export function bindStatePip(input: {
  meta: TerminalMetadata;
  attention: TerminalAttention;
  unread: boolean;
  /** Dock ranking already computed the paint bucket; others omit. */
  pipBucket?: DockRowBucket;
}): StatePipBind {
  const agent = activeArm(input.meta)?.agent;
  const bucket = input.pipBucket ?? paintDockRow(input.meta);
  const variant = pipVariant(bucket);
  // The ONE activity predicate — the same function every host tab and section
  // header counts with, so a still mark is never counted and a moving one never
  // missed.
  const active = isActive(input.attention);
  const motion = pipMotionKind({ variant, active });
  // Live shell keeps idle *variant* (title/a11y stay "Idle") but busy-orange
  // paint via shellLive — not agent "Working".
  const shellLive = !agent && input.attention.live && variant === "idle";
  return {
    variant,
    glyph: pipGlyphFor(input.meta),
    motion,
    active,
    bytesLive: input.attention.live,
    shellLive,
    sleeping: sleepingArm(input.meta) !== undefined,
    alert: input.unread,
    alertLabel: "unread alert",
  };
}

/** Memoized binder for a reactive terminal row — owns the attention read so
 *  call sites do not re-run the fold once per JSX prop. */
export function useStatePip(
  id: Accessor<TerminalId>,
  meta: Accessor<TerminalMetadata>,
  unread: Accessor<boolean>,
  pipBucket?: Accessor<DockRowBucket | undefined>,
): Accessor<StatePipBind> {
  const facts = useAttentionFacts();
  return createMemo(() =>
    bindStatePip({
      meta: meta(),
      attention: facts.attentionOf(meta(), id()),
      unread: unread(),
      pipBucket: pipBucket?.(),
    }),
  );
}
