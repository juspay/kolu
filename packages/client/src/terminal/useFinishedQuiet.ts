/** Mirror of padi's EF2 `finishedIds` — terminals whose `waiting` agent is
 *  effectively finished (quiet ≥ EFFECTIVE_FINISH_QUIET_MS, sticky per episode).
 *
 *  Mirrors each host's `urgency` cell the same way `useTerminalActivity` mirrors
 *  the live set: full-member fan-out, reconcile into a flat per-id store. Dock
 *  and title pips read `isFinished(id)` so motion can hold still once EF2 says
 *  the turn is done — without re-deriving a second quiet timer client-side. */

import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, mapArray, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, padiMap } from "../wire";

export const useFinishedQuiet = createSharedRoot(() => {
  const [finished, setFinished] = createStore<Record<TerminalId, boolean>>({});

  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const host = decodeHostKey(encHost);
      const entry = padiMap.entry(host);
      // Bare `.use()` — urgency declares its own onError policy (see useAttention).
      const { value } = entry.cells.urgency.use();
      // Per-host previous finished set (plain array — never retain a reconcile
      // proxy as prev).
      let prev: TerminalId[] = [];
      createEffect(() => {
        const v = value();
        if (v === undefined) return;
        const next = [...v.finishedIds];
        const nextSet = new Set(next);
        const prevSet = new Set(prev);
        setFinished(
          produce((draft) => {
            for (const id of prev) {
              if (!nextSet.has(id)) delete draft[id];
            }
            for (const id of next) {
              if (!prevSet.has(id)) draft[id] = true;
            }
          }),
        );
        prev = next;
      });
      onCleanup(() => {
        if (prev.length === 0) return;
        setFinished(
          produce((draft) => {
            for (const id of prev) delete draft[id];
          }),
        );
        prev = [];
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
