import type { AttentionTransition, TerminalId } from "kolu-common/surface";

export function nextUnseenFinished(input: {
  unseen: ReadonlySet<TerminalId>;
  candidates: AttentionTransition["candidates"];
  finishedIds: readonly TerminalId[];
  isActiveHost: boolean;
}): Set<TerminalId> {
  const { unseen, candidates, finishedIds, isActiveHost } = input;
  if (isActiveHost) return new Set();
  const finishedNow = new Set(finishedIds);
  const next = new Set<TerminalId>(
    [...unseen].filter((id) => finishedNow.has(id)),
  );
  for (const { id, asking } of candidates) {
    if (!asking) next.add(id);
  }
  return next;
}
