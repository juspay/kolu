/** `useHostAwaiting` — the ONE owner of a host's "awaiting count" derivation.
 *
 *  A chip's amber "needs you" pill reads the host's `urgency` cell and projects
 *  its `awaitingIds.length`. That standing subscription + its onError toast +
 *  the `?? 0` projection are one concept ("what the awaiting pill counts"), so
 *  they live here once rather than being hand-rolled at each render site
 *  (`HostChip`, `HostSwitcherRow`, `MobileHostChip`). When a second per-host
 *  fact lands or `awaitingIds` changes shape, this is the single place it moves.
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

/** The host's awaiting count as a reactive accessor — hidden-at-zero pill fodder.
 *  The urgency cell's declared `hostToast` policy (host-prefixed: `Host <host>
 *  urgency error: …`) routes through the ONE interpreter, so this use-site is bare. */
export function useHostAwaiting(host: HostKey): () => number {
  const urgency = padiMap.entry(host).cells.urgency.use();
  return () => urgency.value()?.awaitingIds.length ?? 0;
}
