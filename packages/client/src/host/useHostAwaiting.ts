/** `useHostAwaiting` — the ONE owner of a host's `awaiting` count.
 *
 *  A chip reads the host's `urgency` cell for the `awaiting` count (agents blocked
 *  on you → the amber "needs you" pill). That standing subscription + its onError
 *  toast + the `?? 0` projection are one concept, so they live here once rather
 *  than being hand-rolled at each render site (`HostChip`, `HostSwitcherRow`,
 *  `MobileHostChip`). The chip's OTHER mark — the quiet "finished" host-tab dot —
 *  does NOT come from here: it reads the unseen-finished mark that `useAttention`
 *  computes cross-host and `attentionMarks` publishes (a finished agent idles in
 *  `waiting` ~forever, so the raw `finishedIds` would light every host forever).
 *
 *  `urgency` is (per the desktop strip's note) the FIRST client consumer of the
 *  keyed map's per-host `urgency` cell — an explicitly early, growing fact set.
 *
 *  Owned-by-caller: this must be called SYNCHRONOUSLY in a component body so the
 *  `.use()` acquires under that component's reactive owner (each `<For>` chip has
 *  its own, disposed when the host leaves the pool) — never at module scope,
 *  where the ref-counted cache would net the listener to zero a microtask later. */

import type { HostKey } from "kolu-common/hostKey";
import { padiMap } from "../wire";

/** A host's asking count as a reactive accessor — hidden-at-zero amber-pill
 *  fodder. The urgency cell's declared `hostToast` policy routes errors through
 *  the ONE interpreter, so this use-site is bare. */
export function useHostAwaiting(host: HostKey): { awaiting: () => number } {
  const urgency = padiMap.entry(host).cells.urgency.use();
  return { awaiting: () => urgency.value()?.awaitingIds.length ?? 0 };
}
