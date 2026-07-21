/** `useHostAwaiting` — the ONE owner of a host's per-host attention counts.
 *
 *  A chip reads the host's `urgency` cell and projects two counts: `awaiting`
 *  (agents blocked on you → the amber "needs you" pill) and `finished` (agents
 *  that just ended a turn → the quiet host-tab mark on a host you aren't looking
 *  at). That standing subscription + its onError toast + the `?? 0` projections
 *  are one concept, so they live here once rather than being hand-rolled at each
 *  render site (`HostChip`, `HostSwitcherRow`, `MobileHostChip`).
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
 *  fodder. (The quiet "finished" host-tab dot is NOT derived from the raw
 *  `finishedIds` here — a finished agent idles in `waiting` ~forever, so that
 *  would light every host permanently; it reads the UNSEEN-finished mark that
 *  `useAttention` computes and `attentionMarks` publishes.) The urgency cell's
 *  declared `hostToast` policy routes errors through the ONE interpreter, so this
 *  use-site is bare. */
export function useHostAwaiting(host: HostKey): { awaiting: () => number } {
  const urgency = padiMap.entry(host).cells.urgency.use();
  return { awaiting: () => urgency.value()?.awaitingIds.length ?? 0 };
}
