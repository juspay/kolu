/** Companion types — the welded canvas-peer relationship between an
 *  anchor terminal tile and an attached panel that lives on the canvas.
 *
 *  A Companion is always attached to its anchor (no detach in Phase 1).
 *  Position is computed from the anchor's bbox + side; the companion has
 *  no canvas coordinates of its own. Maximum one companion per side, up
 *  to four sides per anchor.
 *
 *  Phase 1 ships two CompanionRef kinds — `code` and `inspector`. The
 *  `terminal` kind (sub-terminals migrated from useSubPanel) lands in
 *  Phase 2; do not add it to the union before that work. */

import type { CodeTabView } from "kolu-common/surface";

export type Side = "n" | "e" | "s" | "w";

/** What a companion shows. Phase 1 keeps the Code sub-mode (browse /
 *  local / branch) co-located on the ref so the companion is the single
 *  source of truth for code-view state — no parallel preferences cell. */
export type CompanionRef =
  | { kind: "code"; mode: CodeTabView }
  | { kind: "inspector" };

export interface AnchorCompanion {
  ref: CompanionRef;
  /** Companion's controlled dimension in canvas-space pixels: width when
   *  on E/W, height when on N/S. The perpendicular dimension matches the
   *  anchor's bbox. */
  size: number;
}

export const DEFAULT_COMPANION_WIDTH = 480;

/** Phase 1 default side: companions land on the East side. Side-picker
 *  + multi-side support arrives in Phase 3. */
export const DEFAULT_COMPANION_SIDE: Side = "e";
