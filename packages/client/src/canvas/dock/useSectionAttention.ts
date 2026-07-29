/** The repo-section header's attention facts, wired once for both dock
 *  surfaces (desktop `Dock.tsx`, touch `DockList.tsx`).
 *
 *  The fold itself is `scopeAttention` (pure, beside its two sibling altitudes
 *  in `attention/attentionFacts.ts`); this is the reactive plumbing that hands
 *  it the two readers it needs — the unread ledger and each row's attention
 *  facts — plus the flattening from dock rows to bare ids. Wiring it once means
 *  the two headers can't end up reading different facts into the same fold.
 *
 *  It counts `allTopRows`, not the visible ones: counts must not move when you
 *  toggle a dock filter, and an agent blocked long enough to fall out of the
 *  activity window is precisely the one whose count must still show.
 *
 *  Split entries render for every shell (landing + shared StatePip fold), but
 *  section attention does not: only a split with an agent joins this fold.
 *  That is the agent-counting contract (a shell cannot ask) — not "shells have
 *  no mark"; row chrome lives on the ranked pip + useStatePip path.
 *
 *  It returns IDS rather than counts, because the capsule that renders
 *  `.length` is the same capsule that jumps: the two must walk one list or the
 *  count can promise a target the click cannot reach. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { scopeAttention } from "../../attention/attentionFacts";
import { useAttentionFacts } from "../../attention/useAttentionFacts";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { encActiveHost } from "../../wire";
import type { DockGroup } from "./dockTree";

export type SectionAttention = {
  activeIds: readonly TerminalId[];
  askingIds: readonly TerminalId[];
  unseenIds: readonly TerminalId[];
};

/** Flatten one section to the exact terminals its attention summary owns.
 * Every top-level row participates; only agent-bearing splits do — a shell
 * cannot ask. Shell splits still render the shared StatePip fold on their
 * row; they simply do not join this section count/jump list. */
export function sectionAttentionIds(group: DockGroup): TerminalId[] {
  const ids: TerminalId[] = [];
  for (const row of group.allTopRows) {
    ids.push(row.id);
    for (const sub of row.subRows) {
      if (sub.kind === "agent") ids.push(sub.id);
    }
  }
  return ids;
}

export function useSectionAttention(
  group: Accessor<DockGroup>,
): Accessor<SectionAttention> {
  const store = useTerminalStore();
  const facts = useAttentionFacts();
  return createMemo(() => {
    // The dock renders the ACTIVE host's terminals, so that is the frame every
    // row's facts come off — the shared key memo, so this fold and every pip
    // beneath it read one derivation of it.
    const encHost = encActiveHost();
    const ids = sectionAttentionIds(group());
    return scopeAttention(ids, store.isUnread, (id) =>
      facts.attentionOf(encHost, id),
    );
  });
}
