/** THE ACTIVE HOST'S OWNED WORLD, over a REAL wire — what `activeScope()` must
 *  answer for a suite that drives the product's own hooks at fleet size.
 *
 *  Its `wire` is {@link createHostWire} itself, built over
 *  {@link hostWireMirror}: the real `createReactiveSubscription` keys stream and
 *  the real per-key `useCollection` view, each frame held in the
 *  `createStore<{ v }>` the framework holds it in. That is the whole point — a
 *  suite that judges how WIDE a reading is must pay what the browser pays, and
 *  a hand-written `{ keys, byKey }` over plain arrays under-measures the graph
 *  about threefold (`hostWireMirror`'s own header states the arithmetic).
 *
 *  Its `view`, `prefs` and `restore` are the PRODUCTION factories, wired as
 *  `hostScopes.ts` wires them: `createViewState` over this host's own
 *  `placementOf` / `tileIds` / `terminalKeys` / `listIsCensus` and a real
 *  `createBootPick` gated on a real `createSessionRestore` latch. So the view
 *  facts are the ones production publishes — `focus` is a memo over the
 *  writable memo `override` (NOT a plain signal), `writeFocus` and the
 *  activation side effects exist, the MRU is derived from the persisted visit
 *  trail narrowed to the live census, and `isUnread` reads this host's saved
 *  attention record. A hand-written `view` of plain signals was the blind spot
 *  review 59 §2 names: with no `override` node and no `writeFocus`, every wide
 *  suite built on this library was structurally unable to see a landing effect
 *  relay the census into the view.
 *
 *  WHAT IS NOT BUILT HERE, and why:
 *   - `camera` (`createCamera`): no reading under test asks for it, and it
 *     holds no state another member derives from. A suite that needs it reads
 *     through optional chaining, as the facades do.
 *  Nothing else is stubbed: the two writers below drive the REAL stores the
 *  view derives from — {@link useVisitRecency}'s trail and this host's
 *  {@link attentionRecordOf} record — rather than standing in for them.
 *
 *  A suite using this must mock `@kolu/surface/client`'s `unenrolledStreamCall`
 *  to call the procedure it is handed, `../wire`'s `padiMap.entry` to answer the
 *  mirror's entry, and `../hostScope/hostScopes`'s `activeScope` to answer
 *  {@link FleetScope.scope}; and it must build this inside a `createRoot`. A
 *  suite that LANDS focus also reaches `../wire`'s `padiRpcOf`, through the
 *  host's active-terminal report, so its mock must answer that too. */

import { encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { attentionRecordOf } from "../attention/savedAttention";
import { useVisitRecency } from "../terminal/visitRecency";
import { createBootPick } from "./createBootPick";
import { createHostPrefs, type HostPrefs } from "./createHostPrefs";
import { createHostWire } from "./createHostWire";
import {
  createSessionRestore,
  type HostRestoreLatch,
} from "./createSessionRestore";
import { createViewState, type HostViewState } from "./createViewState";

export interface FleetScope {
  /** What `activeScope()` must answer. */
  readonly scope: unknown;
  /** This host's REAL view state — the member a suite drives focus through
   *  (`writeFocus`, `noteSeededActivation`) and reads the derived facts off. */
  readonly view: HostViewState;
  /** This host's REAL sticky preferences, as `createHostPrefs` builds them. */
  readonly prefs: HostPrefs;
  /** This host's restore latch — the one the derived boot pick is gated on,
   *  so a suite driving hydration drives the latch the scope carries. */
  readonly restore: HostRestoreLatch;
  /** The tile MRU, most-recent first — what the WebGL budget admits from.
   *  Written where production writes it: the persisted visit trail, which
   *  `view.mruOrder` narrows to the live census. */
  setMruOrder(ids: readonly TerminalId[]): void;
  /** The terminals carrying an unread mark, on this host's saved attention
   *  record — the keyed projection `view.isUnread` reads. */
  setUnread(ids: readonly TerminalId[]): void;
}

/** Build the scope. Call inside a `createRoot`: the wire's subscriptions are
 *  owned by whoever builds them, exactly as the per-host owner owns them. */
export function fleetScope(): FleetScope {
  const wire = createHostWire(LOCAL_HOST);
  // The latch before the pick, and the pick before the view: the order
  // `hostScopes.ts` builds them in, and the order their dependencies demand.
  const restore = createSessionRestore();
  const view = createViewState(
    LOCAL_HOST,
    wire.placementOf,
    createBootPick(wire, restore.restoreInFlight),
    wire.tileIds,
    wire.terminalKeys,
    wire.listIsCensus,
  );
  const prefs = createHostPrefs(LOCAL_HOST);
  const visits = useVisitRecency();
  const attention = attentionRecordOf(encodeHostKey(LOCAL_HOST));
  return {
    scope: { wire, view, prefs, restore },
    view,
    prefs,
    restore,
    setMruOrder: (ids) => {
      // The trail is a page-lifetime persisted list, so state the whole order
      // rather than adding to whatever a previous case left: clear this host's
      // slice, then visit oldest-first, since each visit goes to the front.
      visits.clearHost(LOCAL_HOST);
      for (let at = ids.length - 1; at >= 0; at--) {
        const id = ids[at];
        if (id !== undefined) visits.noteVisit(LOCAL_HOST, id);
      }
    },
    setUnread: (ids) => {
      attention.clearAllUnread();
      for (const id of ids) attention.markUnread(id);
    },
  };
}
