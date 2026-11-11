/** The per-host ORCHESTRATOR mirror — one subscription to each host's
 *  `orchestrator` cell, and the one place every surface reads it from.
 *
 *  Every host, not just the one on screen, for the same reason the attention
 *  mirror covers every host: a conversation blocked on a question you cannot see
 *  is exactly the one that has to reach you. The violet badge, the app badge and
 *  the OS popup all count asks across the pool, and they can only do that off a
 *  cell somebody is actually subscribed to.
 *
 *  The cell is SMALL — phase, model, options, rosters, the open-ask ids — and
 *  carries none of the conversation: the transcript is its own stream, opened
 *  only by the panel that draws it. So the standing cost of mirroring the whole
 *  pool is a handful of values per host, which is what makes "every host" the
 *  right default rather than an extravagance.
 *
 *  Shaped after `attention/useAttentionFacts`: one eager root per host keyed on
 *  the ENCODED host string, membership published to a store so readers
 *  invalidate when a host joins or leaves, and the per-host VALUE left behind an
 *  accessor so nothing is copied into a second store that could disagree with
 *  the cell. */

import {
  DEFAULT_ORCHESTRATOR_STATE,
  type OrchestratorState,
} from "@kolu/padi-client/orchestrator";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import { createEffect, mapArray, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createSharedRoot } from "../createSharedRoot";
import { hostKeys, padiMap } from "../wire";

/** Membership, as a store so a read of any host's state re-runs when the pool
 *  changes. The VALUES live in the accessor map below — mirroring a cell into a
 *  second store is how a reader comes to render a frame the cell has moved past. */
const [members, setMembers] = createStore<Record<string, true>>({});
const readers = new Map<string, () => OrchestratorState>();

/** One host's conversation state. `DEFAULT_ORCHESTRATOR_STATE` before the first
 *  frame lands — `phase: "offline"`, which is exactly what this end knows about
 *  a conversation it has not heard from yet. */
export function orchestratorStateOf(encHost: string): OrchestratorState {
  if (members[encHost] === undefined) return DEFAULT_ORCHESTRATOR_STATE;
  return readers.get(encHost)?.() ?? DEFAULT_ORCHESTRATOR_STATE;
}

/** The encoded keys of every host being mirrored — the membership attention and
 *  the badges fold over. */
export function orchestratorHosts(): readonly string[] {
  return Object.keys(members);
}

/** Σ open asks over the pool — the app-badge contribution and the number the
 *  mobile entry wears. Derived at the read site from the id lists themselves, so
 *  there is no second count to disagree with them. */
export function orchestratorAsksTotal(): number {
  let total = 0;
  for (const encHost of orchestratorHosts()) {
    total += orchestratorStateOf(encHost).openAsks.length;
  }
  return total;
}

export const useOrchestratorFacts = createSharedRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (encHost) => {
      const entry = padiMap.entry(decodeHostKey(encHost));
      // Bare `.use()`: the cell DECLARES its own `onError` policy (`hostToast`,
      // labelled `orchestrator`) on the spec, so the use-site carries none and
      // the one shared interpreter surfaces a per-host failure.
      const { value } = entry.cells.orchestrator.use();
      readers.set(encHost, () => value() ?? DEFAULT_ORCHESTRATOR_STATE);
      setMembers(encHost, true);
      onCleanup(() => {
        readers.delete(encHost);
        setMembers(
          produce((current) => {
            delete current[encHost];
          }),
        );
      });
      return null;
    },
  );
  // `mapArray` is lazy until read — instantiate the roots.
  createEffect(() => void roots());
});
