/** `createViewState` — ONE host's per-host SELECTION state, born inside its
 *  `scopedByEntry` owner and retained across switch-away.
 *
 *  This is the successor to `useViewState`'s `HostView` record + the `hosts`
 *  `createStore` hand-keyed by `encodeHostKey(activeHost())`. The enumeration
 *  (a record whose fields a new fact must be remembered into, keyed by hand at a
 *  swap seam) DIES: the owner IS the host, so these are just plain signals —
 *  per-host by construction. Focus (`focusedTerminalId`), MRU order, and per-tile
 *  attention are the ratified "cheap, client-owned" state (ids + order — keeping
 *  them across a switch-away is free); they survive a switch-away in this owner
 *  and are disposed only when the host leaves `padiMap.entries`.
 *
 *  The camera and the sticky per-host PREFERENCES moved OUT to sibling owner
 *  members (`createCamera`, `createHostPrefs`) — they are no longer `HostView`
 *  fields. What W7 TIER A DID leave here is the fullscreen posture
 *  (`canvasMaximized`) — a VIEW OF this host's content (per-host by THE RULE, see
 *  `canvas/canvasBoundaryGuard.test.ts`) that, like the selection facts, a
 *  close-all `reset()` clears. That split is deliberate: everything left in this
 *  factory is reset-on-close-all, so `reset()` clears its WHOLE state with no
 *  "clear these but not those" allow/deny list (the enumeration hazard W7 kills).
 *  The sticky dock filters live in `createHostPrefs` precisely because
 *  they must SURVIVE a close-all. (The right-panel `collapsed` bit is neither here
 *  nor there: it travels with the TILE via `TerminalMetadata.rightPanel` — the
 *  panel's open/closed posture is the tile's, while its tab/selection follow the
 *  focused pane, #959 + follows-focus.) Only the momentary
 *  `centerActiveRequest` command
 *  stays APP-level in the facade — a write-and-consume viewport impulse, never
 *  durable per-host state. The posture is PERSISTED per host
 *  (`kolu-canvasMaximized:<host>`, restoring the pre-W7 reload-survival that the
 *  in-memory W7 signal had dropped) yet still reset-on-close-all — the one
 *  persisted fact this factory owns, since a fullscreen posture over zero tiles is
 *  meaningless; its key is evicted when the host leaves the pool. */

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type Accessor,
  createMemo,
  createSignal,
  type Setter,
  untrack,
} from "solid-js";
import { createKeySelector } from "../createKeySelector";
import { attentionRecordOf } from "../attention/savedAttention";
import { perHostBoolPref } from "../persistedPref";
import { runAction } from "../runAction";
import {
  activeTileOf,
  type TerminalFocus,
  type LivePlacement,
} from "../terminal/focusedTerminal";
import { sameIdOrder } from "../terminal/terminalTree";
import { pickAutoSwitchTarget } from "../terminal/autoSwitchTarget";
import { useVisitRecency } from "../terminal/visitRecency";
import { padiRpcOf } from "../wire";

// A terminal that has drawn attention while unwatched carries a dock unread
// mark. The marks live in this host's saved attention record
// (`savedAttention`), so a reload finds them as they were. The attention engine
// raises a mark there (`deliver`) and drops it when the episode `ended`; this
// view state reads them and drops one when you focus its terminal
// (`writeFocus`).

export interface HostViewState {
  /** The one written focus fact: the terminal receiving keyboard input, whether
   *  it is a top-level tile or a split. */
  focusedTerminalId: Accessor<TerminalId | null>;
  /** The active top-level tile, folded from `focusedTerminalId` via parentId. */
  activeId: Accessor<TerminalId | null>;
  isFocused: (id: TerminalId) => boolean;
  isActiveTile: (id: TerminalId) => boolean;
  /** This host's tile MRU, most-recent-first: the visit trail narrowed to the
   *  tiles that are live now, with tiles the trail has never seen taking
   *  census order behind it. DERIVED — no writer seeds membership into the
   *  trail. */
  mruOrder: Accessor<TerminalId[]>;
  /** The single per-host focus write path. Active-tile side effects use the
   *  ancestor folded from this terminal. */
  writeFocus: (focus: TerminalFocus | null) => void;
  /** Does this terminal carry a dock unread mark? Read from this host's saved
   *  attention record, which the attention engine raises and clears marks on;
   *  this view state clears one when you focus its terminal. */
  isUnread: (id: TerminalId) => boolean;
  // ── Per-host VIEW POSTURE (W7 TIER A) ────────────────────────────────
  /** Fullscreen-one-tile posture for THIS host. Persisted per host
   *  (`kolu-canvasMaximized:<host>`) so it survives reload — the pre-W7 behavior,
   *  restored — and per-host so a switch shows each host's own posture. Cleared by
   *  `reset()` (a close-all writes it back to tiled), so it is the one persisted
   *  fact this factory owns that a close-all still resets: the sticky dock filters
   *  in `createHostPrefs` deliberately SURVIVE a close-all, whereas a fullscreen
   *  posture over zero tiles is meaningless, so close-all floors it. */
  canvasMaximized: Accessor<boolean>;
  setCanvasMaximized: Setter<boolean>;
  reset: () => void;
  /** True when the derived boot pick ALREADY stands on `tileId`: nothing has
   *  overridden it on this host, and the census picks exactly that tile. The
   *  hydration seed asks before it writes — a pick the derivation shows is one
   *  it must not relay into this signal (see {@link createBootPick}). */
  seedCovers: (tileId: TerminalId) => boolean;
  /** The activation SIDE EFFECTS of a seed the derivation covers — the unread
   *  mark, the visit, and the host's active-terminal report, i.e. everything
   *  {@link HostViewState.writeFocus} does besides writing the focus fact,
   *  which the derivation already carries. The VISIT is one of them: the
   *  derived MRU leads with the pick in session, but the trail is what the
   *  NEXT boot reads, and a tile that was the active one with no stamp behind
   *  it is a tile the palette's no-query Enter and the Recent band's reserved
   *  seat cannot see. */
  noteSeededActivation: (tileId: TerminalId) => void;
  /** The tile the focus DERIVATION moved to when the census dropped `from` —
   *  the tile whose departure produced that answer — taken once. `undefined`
   *  when this host's derivation moved nothing FOR THAT DEPARTURE, which is
   *  why the caller names the tile it is evicting: the box is filled by a
   *  derivation, and a derivation recomputes for a host nobody is viewing and
   *  for a drain no eviction follows. Unstamped, such an arming was handed to
   *  the next close of this host's active tile, which then lost its pan, its
   *  `chrome.setActive` report and its unread clear to an answer about another
   *  tile. */
  takeAutoSwitch: (from: TerminalId) => TerminalId | null | undefined;
  /** That switch's imperative half: the unread mark, the visit, and the
   *  host's active-terminal report. */
  noteAutoSwitch: (tileId: TerminalId) => void;
}

/** Whether two focus facts name the same pane and the same tile. `TerminalFocus`
 *  is those two ids and nothing else, so this is the whole value. */
function sameFocus(a: TerminalFocus | null, b: TerminalFocus | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.tileHint === b.tileHint;
}

/** The same question for the OVERRIDE, whose third state — `undefined`, "nothing
 *  has overridden the pick" — is a fact of its own and equals only itself. */
function sameOverride(
  a: TerminalFocus | null | undefined,
  b: TerminalFocus | null | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return sameFocus(a, b);
}

/** The written focus fact AND the census it was last reconciled against. One
 *  node, because the auto-switch policy needs the PRE-removal order, and the
 *  only honest memory of that is the derivation's own previous run. */
type OverrideState = {
  readonly live: readonly TerminalId[];
  readonly focus: TerminalFocus | null | undefined;
};
const NO_OVERRIDE: OverrideState = { live: [], focus: undefined };
function sameOverrideState(a: OverrideState, b: OverrideState): boolean {
  return sameOverride(a.focus, b.focus) && sameIdOrder(a.live, b.live);
}

/** The auto-switch the focus derivation performed, stamped with the departure
 *  that produced it: `from` is the tile that held the selection and left,
 *  `target` the survivor that took its slot (`null` when the top level
 *  emptied). The stamp is the whole point — see
 *  {@link HostViewState.takeAutoSwitch}. */
type AutoSwitch = {
  readonly from: TerminalId;
  readonly target: TerminalId | null;
};

export function createViewState(
  host: HostKey,
  placementOf: (id: TerminalId) => LivePlacement,
  /** This host's DERIVED first active tile (`createBootPick`) — the answer the
   *  focus fact falls back to while nothing has overridden it. */
  seededPick: Accessor<TerminalId | null>,
  /** This host's live top-level tiles in census order (`HostWire.tileIds`) —
   *  the membership {@link HostViewState.mruOrder} narrows the visit trail to. */
  tileIds: Accessor<readonly TerminalId[]>,
): HostViewState {
  // THE FOCUS FACT IS A DERIVATION, NOT A SEEDED SIGNAL. What is written here is
  // the user's OVERRIDE — every activation path (canvas, dock, palette, Ctrl+Tab,
  // a restore's answered tile) — over the boot pick the census already implies.
  // `undefined` means "nothing has overridden it": the pick stands. An explicit
  // `null` is a written fact of its own (a close-all cleared the selection), so
  // the derivation cannot resurrect a tile the user just closed.
  // GATED ON THE FACT IT STATES. A landing verb mints a fresh `{ id, tileHint }`
  // every time, so re-stating the pane that is already focused used to NOTIFY —
  // and the callers that do that most are effect apply arms (the canvas's
  // placement pass re-lands the active tile it just placed, a dock row lands on
  // the pane it is already on). That made this a write RELAYED out of an effect
  // that had just read the terminal census. `focus` carries `equals: sameFocus`,
  // so a re-stated pane recomputed it and published nothing — `activeId` never
  // re-ran — but the activation's SIDE effects did run: a persisted visit and a
  // `chrome.setActive` per re-landing, and that trail write tore `mruOrder`,
  // which had read the same census (the judged `EFFECT_RELAY_TEAR`). Re-stating
  // a fact is not news: the write, the visit and the report are dropped here.
  // The unread mark is not — it is cleared on every landing, re-stated or not,
  // because looking at a terminal ends its mark — and the pane's refocus nonce
  // has its own call site.
  //
  // AND KEYED ON THE CENSUS, so the auto-switch is a DERIVATION too. When the
  // census drops the tile the written fact names, the survivor occupying its
  // slot takes it, in that same flush — the answer the removal reconcile used
  // to write from its apply arm, one flush after the list its compute read,
  // so every reader of the selection ran torn, against the departed tile.
  // `prev.live` is the pre-removal order the policy needs; it is this memo's
  // own memory, which is why the fact and the census ride one node.
  // What the derivation moved the selection to, STAMPED with the tile whose
  // departure produced it, for the imperative half the removal reconcile
  // takes. A plain box: nothing reads it reactively, so a memo may fill it
  // without writing reactive state. The stamp is what makes the one-shot
  // answerable: this derivation runs for EVERY retained host scope, viewed or
  // not (2.0.4 recomputes a writable memo with no readers), and a drain the
  // reconcile suppresses arms it with no eviction behind it — so the taker
  // must prove the answer is about the tile it is evicting.
  let pendingAutoSwitch: AutoSwitch | undefined;
  const [override, setOverride] = createSignal<OverrideState>(
    (prev = NO_OVERRIDE): OverrideState => {
      const live = tileIds();
      const written = prev.focus;
      // Nothing written (the boot pick stands, answered once and deliberately
      // kept when its tile exits), or an explicit "nothing is selected".
      if (written == null) {
        pendingAutoSwitch = undefined;
        return { live, focus: written };
      }
      const tile = untrack(() => activeTileOf(written, placementOf));
      if (tile === null || live.includes(tile) || prev.live.length === 0) {
        pendingAutoSwitch = undefined;
        return { live, focus: written };
      }
      const departing = new Set(prev.live.filter((id) => !live.includes(id)));
      const target = pickAutoSwitchTarget(prev.live, departing, tile);
      // The activation's imperative half is not derivable; it is taken once by
      // the removal reconcile through `takeAutoSwitch`, which answers only the
      // eviction of `tile` — the departure this answer is about.
      pendingAutoSwitch = { from: tile, target };
      return {
        live,
        focus: target === null ? null : { id: target, tileHint: target },
      };
    },
    { equals: sameOverrideState },
  );
  const focus = createMemo<TerminalFocus | null>(
    () => {
      const written = override().focus;
      if (written !== undefined) return written;
      const picked = seededPick();
      // The boot pick names a TILE, so it is its own pane and its own hint.
      return picked === null ? null : { id: picked, tileHint: picked };
    },
    // The derived arm mints its pair fresh on every run, and the pick is
    // re-derived on every census move — so without this every reader of the
    // focus fact re-runs for a selection that did not change.
    { equals: sameFocus },
  );
  const focusedTerminalId = createMemo(() => focus()?.id ?? null);
  const activeId = createMemo(() => activeTileOf(focus(), placementOf));
  // Per-key projections (Solid 2's selector): moving focus wakes the terminal
  // that lost it and the one that took it, not every tile on the canvas.
  const isFocused = createKeySelector(focusedTerminalId);
  const isActiveTile = createKeySelector(activeId);
  // Cross-host visit trail — one client SOT for ⌘K Recent + Ctrl+Tab.
  const visits = useVisitRecency();

  // The canonical host string — the map's `codec.encode(host)`, used in the
  // active-terminal report's error message below and to reach this host's
  // saved attention record. Computed once per owner. (The posture's per-host
  // storage key is composed inside `perHostBoolPref`.)
  const encoded = encodeHostKey(host);
  // The dock unread marks — this host's saved record, the ONE writer of them,
  // shared with the attention engine (which clears a mark on a host whose view
  // state may never have been built).
  const attention = attentionRecordOf(encoded);

  // THIS HOST'S TILE MRU, DERIVED. The persisted trail records ACTIVATIONS —
  // `noteVisit`, and a close-all's clear — and nothing else;
  // which of them are still live, and where a tile the trail has never seen
  // ranks, are answers this census already carries. Folding them here rather
  // than writing them back keeps hydration from relaying the census into a
  // persisted signal the palette, the WebGL budget and Ctrl+Tab all read —
  // which made every one of those readers run torn, against the pre-seed
  // trail.
  const mruOrder = createMemo(
    () => {
      const live = tileIds();
      const liveSet = new Set(live);
      const visited = visits.mruForHost(host).filter((id) => liveSet.has(id));
      const seen = new Set(visited);
      // Never-visited tiles rank below every visit, in the server's order —
      // the order a seeded-then-reconciled trail gave them.
      const order = [...visited, ...live.filter((id) => !seen.has(id))];
      // The ACTIVE tile leads: it is by definition the most recently activated
      // one. A gesture's own visit already puts its tile at the head of the
      // trail, so this only ever hoists a tile the DERIVATION chose — the boot
      // pick before hydration's actor records it, and an auto-switch whose
      // imperative half no eviction has taken yet (a host you are not
      // viewing). It is the in-flush answer; the trail catches up.
      const pick = activeId();
      if (pick === null || !liveSet.has(pick) || order[0] === pick)
        return order;
      return [pick, ...order.filter((id) => id !== pick)];
    },
    {
      // The trail is one cross-host list: a visit on ANOTHER host rewrites it,
      // and this host's slice comes back a new array holding the same ids.
      equals: sameIdOrder,
    },
  );

  // View posture: persisted PER HOST so a host's fullscreen posture survives reload —
  // the pre-W7 behavior, restored — but keyed by host (unlike the pre-W7 GLOBAL
  // `kolu-canvas-maximized` flag) so two hosts don't collide. `perHostBoolPref` owns
  // the `<base>:<host>` key composition + evict-on-host-exit (see its docstring); this
  // factory just names its base. `reset()` still floors it to tiled on close-all (below).
  const [canvasMaximized, setCanvasMaximized] = perHostBoolPref({
    host,
    base: "kolu-canvasMaximized",
    fallback: false,
  });

  function writeFocus(next: TerminalFocus | null): void {
    // Whether this landing MOVES the written fact. A landing that re-states the
    // pane already written is not an activation: the selection does not move,
    // the tile is already at the head of the visit trail, and the host already
    // holds it as active. Sampled, because `writeFocus` runs from effect apply
    // arms (the canvas's placement pass) where a tracked read is forbidden.
    const moved = !sameOverride(untrack(override).focus, next);
    setOverride((prev) => ({ ...prev, focus: next }));
    // Focusing a terminal is one of the two ways its unread mark ends; the other
    // is the attention engine's episode-end edge. Both clear it on the host's
    // record, so a reload does not bring it back.
    if (next) attention.clearUnread(next.id);
    if (!moved) return;
    // SAMPLED: which tile this pane belongs to, read to drive the activation's
    // side effects. `writeFocus` is a WRITE verb — a gesture, or the hydration
    // seed's landing, which runs in an effect CALLBACK, a strict-read window —
    // so this lookup must never subscribe anything to the host's terminal
    // collection. The tracked fold lives in `activeId` above, which is where a
    // placement change is supposed to re-answer.
    const tileId = untrack(() => activeTileOf(next, placementOf));
    if (tileId === null) return;
    noteActivation(tileId);
  }

  /** This host's trailed ids whose terminal is gone — the prune an activation
   *  carries. `placementOf(id).kind === "missing"` is the exact kill test: a
   *  parked row and a split both still have a placement, so only a terminal
   *  the collection no longer holds is dropped. SAMPLED, like every read a
   *  write verb makes: `noteActivation` runs from gestures and from effect
   *  actors, so neither the trail nor the census may become a dependency of
   *  one. */
  function deadVisitIds(): TerminalId[] {
    return untrack(() =>
      visits
        .mruForHost(host)
        .filter((id) => placementOf(id).kind === "missing"),
    );
  }

  /** Everything an activation does BESIDES writing the focus fact — the visit
   *  that ranks this tile in the trail (and prunes the host's dead ids out of
   *  it), and the host's active-terminal report. */
  function noteActivation(tileId: TerminalId): void {
    // THE activation choke point — canvas, dock, palette, Ctrl+Tab all land here.
    visits.noteVisit(host, tileId, { dead: deadVisitIds() });
    reportActive(tileId);
  }

  /** The half a SEEDED activation shares with a gesture: the host's record of
   *  which tile is active. Split out from {@link noteActivation} because the
   *  focus FACT is not written on these paths — the derivation already carries
   *  it — while the report and the visit still are. */
  function reportActive(tileId: TerminalId): void {
    // Report the active terminal to THIS owner's host for its session snapshot.
    // `writeFocus` only ever runs for the shown host (you focus a terminal on the
    // host you are viewing), so this fixed-host entry IS the active-host client.
    // A failure here leaves the server's saved-session snapshot momentarily stale
    // (the NEXT activation re-reports and self-heals), so this is best-effort — but
    // it must not vanish silently: log it so a persistent failure is visible rather
    // than a stale restore with no trace. No toast — this fires on every tile
    // activation, and a background bookkeeping report is not a user-facing action.
    runAction(
      "report active terminal",
      padiRpcOf(host)
        .chrome.setActive({ id: tileId })
        .pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              console.error(
                `hostScope: failed to report active terminal ${tileId} to ${encoded}: ${toError(err).message}`,
              );
            }),
          ),
        ),
    );
  }

  function seedCovers(tileId: TerminalId): boolean {
    return override().focus === undefined && seededPick() === tileId;
  }

  /** The tile the focus derivation moved to when the census dropped `from` —
   *  taken ONCE, because its imperative half must happen once, and only by
   *  the eviction of the tile the answer is about. A derivation recomputes
   *  with no readers, so this box is filled for every retained host scope and
   *  for a drain whose eviction never ran; an unstamped answer was then taken
   *  by the next unrelated close, which lost its own pan and report to it. A
   *  mismatch leaves the box alone: the departure it names may still arrive,
   *  and the derivation's other arms clear it on the next census move. */
  function takeAutoSwitch(from: TerminalId): TerminalId | null | undefined {
    const taken = pendingAutoSwitch;
    if (taken === undefined || taken.from !== from) return undefined;
    pendingAutoSwitch = undefined;
    return taken.target;
  }

  /** That switch's imperative half: the unread mark, plus everything an
   *  activation does — because a tile the derivation hands the slot to IS the
   *  active tile, and the trail's contract is that becoming the active tile
   *  records a visit. In session the derived MRU would lead with it anyway;
   *  across a reload the stamp is the only memory of where you were, which is
   *  what the palette's no-query Enter and the Recent band's reserved seat
   *  rank by. */
  function noteAutoSwitch(tileId: TerminalId): void {
    attention.clearUnread(tileId);
    noteActivation(tileId);
  }

  /** The same for the boot pick the derivation covers: the mark, the visit and
   *  the host's report. The visit is what gives a cold-booted tile a stamp to
   *  come back to on the NEXT boot — the trail is this browser's memory of
   *  where it has been, not of this session's gestures only. */
  function noteSeededActivation(tileId: TerminalId): void {
    attention.clearUnread(tileId);
    noteActivation(tileId);
  }

  function reset(): void {
    // This factory owns ONLY reset-on-close-all state — the selection facts
    // (active tile, MRU, attention) plus the maximized posture. The sticky per-host
    // PREFERENCES moved to `createHostPrefs`, so there is no "clear these but not
    // the prefs" allow/deny list to keep in sync: `reset` unconditionally clears
    // every signal this factory owns. Closing every tile drops this host back to
    // the tiled posture (matching the pre-per-host `reset` clearing `canvasMaximized`);
    // `setCanvasMaximized(false)` also writes `"false"` through the boolPref, so the
    // persisted posture is floored too — a reload after a close-all stays tiled.
    // An EXPLICIT null, not a drop back to the derivation: a close-all is a
    // written "nothing is selected", and the census it empties is observed a
    // flush later. Dropping to the pick would paint a doomed tile active for
    // that flush; the next activation (or an in-session restore's seed, which
    // asks `seedCovers` and finds the derivation overridden) writes it again.
    setOverride((prev) => ({ ...prev, focus: null }));
    visits.clearHost(host);
    attention.clearAllUnread();
    setCanvasMaximized(false);
  }

  return {
    focusedTerminalId,
    activeId,
    isFocused,
    isActiveTile,
    mruOrder,
    writeFocus,
    isUnread: attention.isUnread,
    canvasMaximized,
    setCanvasMaximized,
    reset,
    seedCovers,
    noteSeededActivation,
    takeAutoSwitch,
    noteAutoSwitch,
  };
}
