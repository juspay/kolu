/** Mirror of padi's EF2 `finishedIds` — terminals whose `waiting` agent is
 *  effectively finished (quiet ≥ EFFECTIVE_FINISH_QUIET_MS, sticky per episode).
 *
 *  Same shape as `useTerminalActivity`: full-member fan-out over host urgency
 *  cells, `createActivityFrameReducer` for the prev-snapshot / Set-diff fence,
 *  flat per-id store. Dock and title pips read `isFinished(id)` so the motion
 *  fold can apply the EF2 linger leg (`!isFinished`); live output re-lights
 *  motion independently (#1955). */

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, mapArray, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, padiMap } from "../wire";
import { createActivityFrameReducer } from "./useTerminalActivity";

export const useFinishedQuiet = createSharedRoot(() => {
  const [finished, setFinished] = createStore<Record<TerminalId, boolean>>({});

  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      // Bare `.use()` — urgency declares its own onError policy (see useAttention).
      // Gate on pending; clear on absent fact (do not freeze last finishedIds).
      const { value, sub } = entry.cells.urgency.use();
      const reduce = createActivityFrameReducer((adds, removes) =>
        setFinished(
          produce((draft) => {
            for (const id of adds) draft[id] = true;
            for (const id of removes) delete draft[id];
          }),
        ),
      );
      createEffect(() => {
        if (sub.pending()) return;
        const v = value();
        // Past-pending undefined → empty frame (drop this host's finished keys).
        reduce.apply(v === undefined ? [] : v.finishedIds);
      });
      onCleanup(() => {
        const held = reduce.drain();
        if (held.length === 0) return;
        setFinished(
          produce((draft) => {
            for (const id of held) delete draft[id];
          }),
        );
      });
      return null;
    },
  );
  createEffect(() => void roots());

  function isFinished(id: TerminalId): boolean {
    return finished[id] === true;
  }

  return { isFinished };
});
