/** The dock's `bucket` → `PipVariant` rule — the Dock-local glue that feeds the
 *  CORE of the shared `StatePip` (now in `@kolu/solid-statepip`). Pure, so it's
 *  independently testable without a Solid render harness.
 *
 *  The three agent-paint buckets route through the SHARED `pipForPaintClass`, so
 *  the pip a given agent paint class shows is defined ONCE — the same fold
 *  pulam-web's `pipVariantFor` calls — and can't drift between the two surfaces.
 *  This function adds only the dock-only `idle`/`sleeping`/`parked` triage
 *  buckets that have no agent paint to share.
 *
 *  `unread` is NO LONGER folded in here (R-activity-merge): an unread alert used
 *  to REPLACE the whole pip with a loud `attention` disk; it now rides as the
 *  indicator's amber HALO (`StatePip`'s `alert` prop) WRAPPING the live state
 *  core instead of hiding it — so the obligation and the state read at once. The
 *  core is just the bucket's state; the caller passes `alert` separately. */

import {
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
    // The dock's own triage tail — no agent paint to share with pulam-web.
    case "idle":
      return "idle";
    case "sleeping":
      return "sleeping";
    case "parked":
      return "empty";
  }
}
