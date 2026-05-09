/** useCompanion — singleton store for canvas-peer companion attachments.
 *
 *  Per-anchor map keyed by TerminalId. Each anchor can hold up to four
 *  welded companions (one per side); Phase 1 only ever writes the East
 *  side, so the multi-side machinery is structural-only and exercised
 *  fully in Phase 3 when the side picker lands.
 *
 *  Phase 1 keeps state ephemeral (in-memory, not persisted). The previous
 *  `preferences.rightPanel` record is no longer written; a follow-up
 *  drops the schema field server-side. Re-opening a companion after a
 *  page reload starts fresh — acceptable for Phase 1, since the right
 *  panel's persisted state was a single global, not a per-tile concept. */

import type { TerminalId } from "kolu-common/surface";
import { createStore, produce } from "solid-js/store";
import {
  type AnchorCompanion,
  type CompanionRef,
  DEFAULT_COMPANION_SIDE,
  DEFAULT_COMPANION_WIDTH,
  type Side,
} from "./types";

type AnchorCompanions = Partial<Record<Side, AnchorCompanion>>;

const [state, setState] = createStore<Record<TerminalId, AnchorCompanions>>({});

/** Toggle-identity is the discriminant kind only — sub-mode is content-
 *  navigation state, not toggle state. If the user opened Code, switched
 *  it to "browse", then re-pressed the Code-companion shortcut, the
 *  expected outcome is "close" (re-press toggles), not "silently reset
 *  the sub-mode to local". Comparing modes here would couple the toggle
 *  decision to view state and break that contract. */
function sameKind(a: CompanionRef, b: CompanionRef): boolean {
  return a.kind === b.kind;
}

export function useCompanion() {
  return {
    /** All companions attached to an anchor, keyed by side. */
    getCompanions(anchorId: TerminalId): AnchorCompanions {
      return state[anchorId] ?? {};
    },

    /** The companion on a given side, or undefined. */
    getCompanion(
      anchorId: TerminalId,
      side: Side,
    ): AnchorCompanion | undefined {
      return state[anchorId]?.[side];
    },

    /** Open `ref` on the East side of `anchorId` (Phase 1's only
     *  writeable side). Re-pressing the same toggle with the same ref
     *  closes the companion; pressing a different ref replaces. */
    toggleCompanion(anchorId: TerminalId, ref: CompanionRef) {
      const side = DEFAULT_COMPANION_SIDE;
      const existing = state[anchorId]?.[side];
      if (existing && sameKind(existing.ref, ref)) {
        this.closeCompanion(anchorId, side);
        return;
      }
      setState(
        anchorId,
        produce((sides) => {
          sides[side] = { ref, size: DEFAULT_COMPANION_WIDTH };
        }),
      );
    },

    /** Set the persisted size for a side's companion. No-op when there's
     *  no companion to size. */
    setCompanionSize(anchorId: TerminalId, side: Side, size: number) {
      const sides = state[anchorId];
      if (!sides?.[side]) return;
      setState(anchorId, side, "size", size);
    },

    /** Mutate the ref of an existing companion (e.g. switching the Code
     *  companion's sub-mode without recreating the slot). No-op when
     *  there's no companion on that side. */
    setCompanionRef(anchorId: TerminalId, side: Side, ref: CompanionRef) {
      const sides = state[anchorId];
      if (!sides?.[side]) return;
      setState(anchorId, side, "ref", ref);
    },

    /** Close a single side's companion. */
    closeCompanion(anchorId: TerminalId, side: Side) {
      setState(
        anchorId,
        produce((sides) => {
          delete sides[side];
        }),
      );
    },

    /** Drop all companions for an anchor that's going away. Called from
     *  terminal kill paths to keep the store from leaking entries. */
    removeAnchor(anchorId: TerminalId) {
      setState(produce((s) => delete s[anchorId]));
    },
  } as const;
}
