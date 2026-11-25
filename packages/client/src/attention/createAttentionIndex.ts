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
  // terminal's bytes wakes that terminal's readers and nobody else. The
  // record answers which ids are live NOW; the commit's reconcile channel
  // derives the rest — a key this run left out reads `undefined` and wakes
  // only the readers of that key.
  const live = createProjection<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};
    for (const id of liveIds()) next[id] = true;
    return next;
  });
  return {
    classOf: (id) => classes[id] ?? "idle",
    isLive: (id) => live[id] === true,
    activeCount: createMemo(
      () =>
        hostActiveIds({ byClass: byClass(), liveIds: [...liveIds()] }).length,
    ),
  };
}
