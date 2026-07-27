/** The repo-section header's attention counts, wired once for both dock
 *  surfaces (desktop `Dock.tsx`, touch `DockList.tsx`).
 *
 *  The fold itself is `sectionAttention` (pure, in `dockTree.ts`); this is the
 *  reactive plumbing that hands it the two readers it needs — the unread ledger
 *  and each row's attention facts. Wiring it once means the two headers can't
 *  end up reading different facts into the same fold.
 *
 *  It counts `allRows`, not the visible ones: the counts must not move when you
 *  toggle a dock filter, and an agent blocked long enough to fall out of the
 *  activity window is precisely the one whose count must still show. */

import { type Accessor, createMemo } from "solid-js";
import { NO_ATTENTION } from "../../attention/attentionFacts";
import { useAttentionFacts } from "../../attention/useAttentionFacts";
import { useTerminalStore } from "../../terminal/useTerminalStore";
import { type DockGroup, sectionAttention } from "./dockTree";

export function useSectionAttention(
  group: Accessor<DockGroup>,
): Accessor<{ active: number; asking: number; unseen: number }> {
  const store = useTerminalStore();
  const facts = useAttentionFacts();
  return createMemo(() =>
    sectionAttention(group().allRows, store.isUnread, (id) => {
      const meta = store.getMetadata(id);
      // A row whose metadata has already gone (a terminal closing as the dock
      // repaints) contributes nothing rather than a guess.
      return meta ? facts.attentionOf(meta, id) : NO_ATTENTION;
    }),
  );
}
