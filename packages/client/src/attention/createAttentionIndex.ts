import {
  FRAME_CLASSES,
  hostActiveIds,
  type HostAttentionFrame,
} from "@kolu/padi-client/attention";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createMemo,
  createProjection,
  createSelector,
} from "solid-js";
import type { HostAttentionIndex } from "./attentionMarks";

/** Index the host's two independent facts by terminal, notifying only changed ids. */
export function createAttentionIndex(
  byClass: Accessor<HostAttentionFrame["byClass"]>,
  liveIds: Accessor<readonly TerminalId[]>,
): HostAttentionIndex {
  // A DERIVED store, so a frame that moves one terminal's class wakes only the
  // readers of that id.
  const classes = createProjection<Record<string, AttentionClass>>(() => {
    const next: Record<string, AttentionClass> = {};
    const frame = byClass();
    for (const klass of FRAME_CLASSES)
      for (const id of frame[klass]) next[id] = klass;
    return next;
  });
  const liveSet = createMemo(() => new Set(liveIds()));
  const isLive = createSelector(liveSet, (id: TerminalId, ids) => ids.has(id));
  return {
    classOf: (id) => classes[id] ?? "idle",
    isLive,
    activeCount: createMemo(
      () =>
        hostActiveIds({ byClass: byClass(), liveIds: [...liveIds()] }).length,
    ),
  };
}
