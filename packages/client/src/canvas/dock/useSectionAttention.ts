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
    const encHost = encActiveHost();
    const ids = sectionAttentionIds(group());
    return scopeAttention(ids, store.isUnread, (id) =>
      facts.attentionOf(encHost, id),
    );
  });
}
