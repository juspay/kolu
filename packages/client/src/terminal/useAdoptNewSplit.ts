/** Adopt an externally-created split — the ARRIVAL mirror of useActiveReconcile.
 *
 *  A split created OUTSIDE the browser (`padi-tui create --parent`, another
 *  client, a future API) reaches the daemon via `lifecycle.create({parentId})`
 *  and shows up on the terminals collection — but nothing runs the two
 *  BROWSER-LOCAL steps the manual split path does (`useTerminalCrud.
 *  handleCreateSubTerminal`): expand the parent's sub-panel and select the new
 *  tab. Without them the sub-panel keeps its prior state and the new sub's body
 *  never paints — its `visible` gate is `activeSubTab() === subId`, and no one
 *  set `activeSubTab`. This hook closes that gap by REACTING to the arrival on
 *  the list, so a split from ANY actor behaves like a manual one.
 *
 *  Expand-but-don't-steal: a new split ALWAYS expands the parent's panel (like a
 *  manual create), but becomes the ACTIVE tab only when the parent has no LIVE
 *  active split — an arrival never yanks the view off a split you're already
 *  working in. "Live" is load-bearing: `activeSubTab` is NOT cleared when a
 *  parent's last split departs (the reconcile only collapses the panel), so a
 *  stale tab can dangle at a gone sub; a non-null-only guard would then open the
 *  arrival BEHIND that dead tab and never paint it — the very bug this hook
 *  fixes. So the guard tests membership in the parent's current live subs.
 *
 *  Adopt only in a LIVE, seeded session. During initial load / restore /
 *  supervised recycle the host is not `seeded` and `useSessionRestore` owns the
 *  sub-panel tabs (it restores the persisted collapsed state and picks
 *  `subIds[0]`); adopting there would fight hydration. The restore `phase` is
 *  DELIBERATELY non-reactive (`createSessionRestore`), so it is SAMPLED, never
 *  tracked — and the baseline can't lean on reacting to the seed transition:
 *  every sub is recorded into `seen` regardless of phase, so a sub present
 *  before the host seeds is baseline (never a false arrival), and only a
 *  genuinely-new sub that appears WHILE seeded is adopted. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createMemo, on } from "solid-js";
import type { HydrationPhase } from "../hostScope/createSessionRestore";
import { sameParentSnapshot } from "./useActiveReconcile";

/** The sub-panel seams a new split drives — read live, mutated to adopt. Bundled
 *  so the hook is a pure function of (ports, list, phase): unit-testable with
 *  plain spies, wired once in useTerminals. */
export interface SplitAdoptPorts {
  /** Expand the parent's sub-panel (idempotent) — run on every adopted split. */
  expandPanel: (parentId: TerminalId) => void;
  /** The parent's current active sub-tab (`null` when none is selected; may be
   *  STALE — pointing at a departed sub — since the reconcile doesn't clear it). */
  activeSubTab: (parentId: TerminalId) => TerminalId | null;
  /** Select a sub-tab — run only when the parent has no LIVE active split (don't
   *  steal from a split you're in, but a stale tab is not an active split). */
  setActiveSubTab: (parentId: TerminalId, subId: TerminalId) => void;
}

export function useAdoptNewSplit(deps: {
  /** Raw list keys (all ids — top-level AND sub — membership-driven). */
  rawList: Accessor<TerminalId[]>;
  /** Live parentId for a listed id (`null` for top-level). */
  parentOf: (id: TerminalId) => TerminalId | null;
  /** The canonical ACTIVE-host key. Carried in the snapshot so a host SWITCH
   *  rebaselines (its existing splits are not mass arrivals) — the same disjoint
   *  id-space concern useActiveReconcile guards. */
  activeHostKey: () => string;
  /** SAMPLED restore phase for the active host (non-reactive by design). */
  restorePhase: () => HydrationPhase;
  ports: SplitAdoptPorts;
}) {
  // A live snapshot of every SUB terminal's parentId (top-level ids excluded), in
  // key order, tagged with the active host. `equals` wakes the effect only on a
  // sub membership/parent change or a host switch — the reconcile sibling's gate.
  const snapshot = createMemo<{
    host: string;
    map: Map<TerminalId, TerminalId>;
  }>(
    () => {
      const m = new Map<TerminalId, TerminalId>();
      for (const id of deps.rawList()) {
        const parentId = deps.parentOf(id);
        if (parentId !== null) m.set(id, parentId);
      }
      return { host: deps.activeHostKey(), map: m };
    },
    { host: "", map: new Map() },
    { equals: (a, b) => a.host === b.host && sameParentSnapshot(a.map, b.map) },
  );

  // Every sub id already accounted for on the CURRENT host — a sub NOT in here is
  // a candidate for adoption. Accumulated regardless of phase so a sub present
  // before the host seeds is baseline, never a false arrival. Reset (with the
  // host token) on a switch, so the switched-to host's existing splits baseline
  // rather than all "arriving" at once.
  const seen = new Set<TerminalId>();
  let seenHost: string | undefined;

  createEffect(
    on(snapshot, (snap) => {
      // Host switch (or first run) — rebaseline to this host's current subs and
      // adopt NONE: switching to a host must not auto-open its existing splits.
      if (seenHost !== snap.host) {
        seen.clear();
        for (const id of snap.map.keys()) seen.add(id);
        seenHost = snap.host;
        return;
      }
      // `on` runs this callback untracked, so the SAMPLED phase read (and the
      // ports' live reads below) add no dependency — the effect wakes only on a
      // snapshot change, exactly like the reconcile.
      const seeded = deps.restorePhase() === "seeded";
      for (const [subId, parentId] of snap.map) {
        if (seen.has(subId)) continue;
        seen.add(subId); // record even when not seeded — keeps the baseline honest
        if (!seeded) continue; // load/restore/recycle → hydration owns the tabs
        deps.ports.expandPanel(parentId);
        // Don't-steal, but only from a LIVE split: adopt through a `null` OR a
        // STALE active tab (one no longer among this parent's live subs — left
        // dangling when the parent's last split was closed). `snap.map` is the
        // live sub→parent set, so membership is the liveness test.
        const active = deps.ports.activeSubTab(parentId);
        const activeIsLiveSub =
          active !== null && snap.map.get(active) === parentId;
        if (!activeIsLiveSub) deps.ports.setActiveSubTab(parentId, subId);
      }
    }),
  );
}
