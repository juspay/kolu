import { createAttentionIndex } from "./createAttentionIndex";

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { AttentionClass, TerminalId } from "kolu-common/surface";
import { createEffect, createMemo, mapArray, onCleanup } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, interpretClientError, padiMap } from "../wire";
import {
  emptyByClass,
  type FrameClass,
  frameByClass,
  type TerminalAttention,
} from "@kolu/padi-client/attention";
import {
  registerHostAttention,
  terminalAttention,
  terminalClass,
} from "./attentionMarks";
import { forgetAttentionRecord } from "./savedAttention";

export const useAttentionFacts = createSharedRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      const { value: urgency, sub } = entry.cells.urgency.use();
      const activity = entry.streams.activity.use(() => ({}), {
        onError: (err) =>
          interpretClientError({ kind: "hostToast", label: "activity" }, err, {
            key: host,
          }),
      });
      if (!sub.complete)
        throw new Error("Urgency subscription must expose completion");
      const complete = sub.complete;
      const live = createMemo(
        () => entry.state().kind === "connected" && !sub.error() && !complete(),
      );

      const lastSettledByClass = createMemo(
        (previous: Record<FrameClass, TerminalId[]>) => {
          const value = urgency();
          return value?.settled === true ? frameByClass(value) : previous;
        },
        emptyByClass(),
      );
      const liveIds = createMemo<readonly TerminalId[]>(
        (previous) => (activity.pending() ? previous : [...(activity() ?? [])]),
        [],
      );
      const reported = createMemo(
        (previous: boolean) =>
          activity.pending()
            ? previous
            : previous || urgency()?.settled === true,
        false,
      );
      onCleanup(
        registerHostAttention(encHost, {
          facts: () => ({
            get reported() {
              return reported();
            },
            get byClass() {
              return lastSettledByClass();
            },
            get liveIds() {
              return liveIds();
            },
            get live() {
              return live();
            },
          }),
          index: createAttentionIndex(lastSettledByClass, liveIds),
          onDrop: () => forgetAttentionRecord(encHost),
        }),
      );
      return null;
    },
  );
  createEffect(() => void roots());

  return {
    classOf: (encHost: string, id: TerminalId): AttentionClass =>
      terminalClass(encHost, id),
    attentionOf: (encHost: string, id: TerminalId): TerminalAttention =>
      terminalAttention(encHost, id),
  };
});
