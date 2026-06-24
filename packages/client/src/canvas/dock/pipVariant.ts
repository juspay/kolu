/** The dock's `(bucket, unread)` → `PipVariant` rule — the Dock-local glue that
 *  feeds the shared `StatePip` (now in `@kolu/solid-statepip`). Pure, so it's
 *  independently testable without a Solid render harness.
 *
 *  The three agent-paint buckets route through the SHARED `pipForPaintClass`, so
 *  the pip a given agent paint class shows is defined ONCE — the same fold
 *  pulam-web's `pipVariantFor` calls — and can't drift between the two surfaces.
 *  This function adds only the dock's OWN overlays on top: `unread` dominates the
 *  bucket (a row that fired a background alert still reads "attention" even after
 *  the agent moved on, because the unread obligation outlives the transition
 *  until the user activates the row), plus the dock-only `idle`/`sleeping`/
 *  `parked` triage buckets that have no agent paint to share. */

import {
  type PipVariant,
  pipForPaintClass,
} from "@kolu/solid-statepip/pipVariant";
import type { DockRowBucket } from "./dockRowRanking";

export type { PipVariant };

export function pipVariant(bucket: DockRowBucket, unread: boolean): PipVariant {
  if (unread) return "attention";
  switch (bucket) {
    // The agent-paint subset (`DockRowBucket` extends `AgentPaintClass`) folds
    // through the shared definition.
    case "awaiting":
    case "working":
    case "none":
      return pipForPaintClass(bucket);
    // The dock's own triage tail — no agent paint to share with pulam-web.
    case "idle":
      return "idle";
    case "sleeping":
      return "sleeping";
    case "parked":
      return "empty";
  }
}
