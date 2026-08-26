/** The repo-section header's attention facts, wired once for both dock
 *  surfaces (desktop `Dock.tsx`, touch `DockList.tsx`).
 *
 *  The fold itself is `scopeAttention` (pure, beside its two sibling altitudes
 *  in `@kolu/padi-client/attention`); this is the reactive plumbing that hands
 *  it the two readers it needs — the unread ledger and each row's attention
 *  facts — plus the flattening from dock rows to bare ids. Wiring it once means
 *  the two headers can't end up reading different facts into the same fold.
 *
 *  It counts `allTopRows`, not the visible ones: counts must not move when you
 *  toggle a dock filter, and an agent blocked long enough to fall out of the
 *  activity window is precisely the one whose count must still show.
 *
 *  Split entries widen to every sub-row id (shell and agent). The fold itself
 *  decides each leg: a shell cannot appear in asking (padi never lists it),
 *  but live and unread shells join active/unseen the same way top-level shells
 *  do — so a spinning shell-split pip cannot sit under an uncounting header.
 *
 *  It returns IDS rather than counts, because the capsule that renders
 *  `.length` is the same capsule that jumps: the two must walk one list or the
 *  count can promise a target the click cannot reach. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { scopeAttention } from "@kolu/padi-client/attention";
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
 * Every top-level row and every split participates. The fold decides each leg
 * (asking self-excludes agentless ids; live/unread shells count). Kind never
 * re-gates membership — the same "kind is not a chrome/count axis" rule the
 * row surfaces already follow for paint, motion, and unread. */
export function sectionAttentionIds(group: DockGroup): TerminalId[] {
  const ids: TerminalId[] = [];
  for (const row of group.allTopRows) {
    ids.push(row.id);
    for (const sub of row.subRows) {
      ids.push(sub.id);
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
