/** The dock's `bucket` → `PipVariant` rule — the Dock-local glue that feeds the
 *  CORE of the shared `StatePip` (now in `@kolu/solid-statepip`). Pure, so it's
 *  independently testable without a Solid render harness.
 *
 *  The three agent-paint buckets route through the SHARED `pipForPaintClass`, so
 *  the pip a given agent paint class shows is defined ONCE — the same fold
 *  a fleet mirror's `pipVariantFor` calls — and can't drift between surfaces.
 *  This function adds only the dock-only `idle`/`sleeping`/`parked` triage
 *  buckets that have no agent paint to share.
 *
 *  `unread` is NO LONGER folded in here (R-activity-merge): an unread alert used
 *  to REPLACE the whole pip with a loud `attention` disk; it now rides as the
 *  indicator's amber corner BADGE (`StatePip`'s `alert` prop) BESIDE the live
 *  state core instead of hiding it — so the obligation and the state read at
 *  once. The
 *  core is just the bucket's state; the caller passes `alert` separately.
 *
 *  Identity (who is driving the terminal) is a SEPARATE axis — `pipGlyphFor`
 *  below — so paint and brand mark don't complect. */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import {
  type PipGlyphId,
  type PipVariant,
  pipForPaintClass,
} from "@kolu/solid-statepip/pipVariant";
import type { DockRowBucket } from "./dockRowRanking";

export function pipVariant(bucket: DockRowBucket): PipVariant {
  switch (bucket) {
    // The agent-paint subset (`DockRowBucket` extends `AgentPaintClass`) folds
    // through the shared definition.
    case "awaiting":
    case "working":
    case "none":
      return pipForPaintClass(bucket);
    // The dock's own triage tail — no agent paint to share with a fleet mirror.
    case "idle":
      return "idle";
    case "sleeping":
      return "sleeping";
    case "parked":
      return "empty";
  }
}

/** Identity glyph for a dock/title pip — live agent kind, else the persisted
 *  resume identity on a sleeping (or just-quit) terminal, else the shell
 *  prompt. One place every StatePip call site reads "who is driving this". */
export function pipGlyphFor(meta: TerminalMetadata): PipGlyphId {
  const live = activeArm(meta)?.agent?.kind;
  if (live) return live;
  const target = meta.restoreTarget;
  if (target?.kind === "exact") return target.agent.kind;
  return "shell";
}
