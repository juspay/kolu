/** The repo-section header's attention facts, wired once for both dock
 *  surfaces (desktop `Dock.tsx`, touch `DockList.tsx`).
 *
 *  The fold itself is `scopeAttention` (pure, beside its two sibling altitudes
 *  in `attention/attentionFacts.ts`); this is the reactive plumbing that hands
 *  it the two readers it needs — the unread ledger and each row's attention
 *  facts — plus the flattening from dock rows to bare ids. Wiring it once means
 *  the two headers can't end up reading different facts into the same fold.
 *
 *  It counts `allRows`, not the visible ones: the counts must not move when you
 *  toggle a dock filter, and an agent blocked long enough to fall out of the
 *  activity window is precisely the one whose count must still show.
 *
 *  It counts every SPLIT id, not just the agent-bearing splits that earn a
 *  rendered line — the host tab above counts a plain shell printing in a split,
 *  so a header that folded only the rendered sub-entries reported one fewer
 *  than the tab directly above it.
 *
 *  It returns IDS, and `parentOf` for the ones that are splits, because the
 *  capsule that renders `.length` is the same capsule that jumps: the two must
 *  walk one list or the count can promise a target the click cannot reach. */

import { encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { scopeAttention } from "../../attention/attentionFacts";
import { useAttentionFacts } from "../../attention/useAttentionFacts";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { activeHost } from "../../wire";
import type { DockGroup } from "./dockTree";

export type SectionAttention = {
  activeIds: readonly TerminalId[];
  askingIds: readonly TerminalId[];
  unseenIds: readonly TerminalId[];
  /** The terminal a counted id is a SPLIT of, for the ids that are splits —
   *  what `useDockFocus` needs to land on one. */
  parentOf: ReadonlyMap<TerminalId, TerminalId>;
};

export function useSectionAttention(
  group: Accessor<DockGroup>,
): Accessor<SectionAttention> {
  const store = useTerminalStore();
  const facts = useAttentionFacts();
  return createMemo(() => {
    // The dock renders the ACTIVE host's terminals, so that is the frame every
    // row's facts come off — one host key, read once per fold.
    const encHost = encodeHostKey(activeHost());
    const parentOf = new Map<TerminalId, TerminalId>();
    const ids: TerminalId[] = [];
    for (const row of group().allRows) {
      ids.push(row.id);
      for (const subId of row.subIds) {
        ids.push(subId);
        parentOf.set(subId, row.id);
      }
    }
    return {
      ...scopeAttention(ids, store.isUnread, (id) =>
        facts.attentionOf(encHost, id),
      ),
      parentOf,
    };
  });
}
