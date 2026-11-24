import {
  FRAME_CLASSES,
  hostActiveIds,
  type HostAttentionFrame,
} from "@kolu/padi-client/attention";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo, createProjection } from "solid-js";
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
  // The live set, indexed the same way: a frame that starts or stops one
  // terminal's bytes wakes that terminal's readers and nobody else. The ids
  // that were live last run are remembered so the ones that left can be
  // cleared — a projection draft keeps what the previous run wrote.
  let held: ReadonlySet<TerminalId> = new Set<TerminalId>();
  const live = createProjection<Record<string, boolean>>((draft) => {
    const next = new Set(liveIds());
    for (const id of held) if (!next.has(id)) delete draft[id];
    for (const id of next) draft[id] = true;
    held = next;
  }, {});
  return {
    classOf: (id) => classes[id] ?? "idle",
    isLive: (id) => live[id] === true,
    activeCount: createMemo(
      () =>
        hostActiveIds({ byClass: byClass(), liveIds: [...liveIds()] }).length,
    ),
  };
}
