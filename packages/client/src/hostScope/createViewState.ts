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
import { type Accessor, createMemo, createSignal, type Setter } from "solid-js";
import { createKeySelector } from "../createKeySelector";
import { attentionRecordOf } from "../attention/savedAttention";
import { perHostBoolPref } from "../persistedPref";
import { runAction } from "../runAction";
import {
  activeTileOf,
  type TerminalFocus,
  type LivePlacement,
} from "../terminal/focusedTerminal";
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
  mruOrder: Accessor<TerminalId[]>;
  /** The single per-host focus write path. Active-tile side effects use the
   *  ancestor folded from this terminal. */
  writeFocus: (focus: TerminalFocus | null) => void;
  /** Seed empty host trail / reconcile live membership (order is seed-only). */
  reconcileLiveIds: (liveIds: readonly TerminalId[]) => void;
  /** Drop one terminal from the durable visit trail (kill path). */
  forgetFromMru: (id: TerminalId) => void;
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
   *  mark, the visit trail and the host's active-terminal report, i.e. exactly
   *  what {@link HostViewState.writeFocus} does besides writing the fact. */
  noteSeededActivation: (tileId: TerminalId) => void;
}

export function createViewState(
  host: HostKey,
  placementOf: (id: TerminalId) => LivePlacement,
  /** This host's DERIVED first active tile (`createBootPick`) — the answer the
   *  focus fact falls back to while nothing has overridden it. */
  seededPick: Accessor<TerminalId | null>,
): HostViewState {
  const [focus, setFocus] = createSignal<TerminalFocus | null>(null);
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

  // Host-filtered slice of the visit MRU (most-recent first). Replaces the old
  // per-host in-memory list so cycling order survives reloads.
  const mruOrder = createMemo(() => visits.mruForHost(host));

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
    setOverride(next);
    // Focusing a terminal is one of the two ways its unread mark ends; the other
    // is the attention engine's episode-end edge. Both clear it on the host's
    // record, so a reload does not bring it back.
    if (next) attention.clearUnread(next.id);
    const tileId = activeTileOf(next, placementOf);
    if (tileId === null) return;
    noteActivation(tileId);
  }

  /** Everything an activation does BESIDES writing the focus fact. Split out so
   *  the hydration seed can perform them for a pick the derivation already shows
   *  — the fact needs no write there, but the trail and the host's report are
   *  not derivable and still have to happen exactly once. */
  function noteActivation(tileId: TerminalId): void {
    // THE activation choke point — canvas, dock, palette, Ctrl+Tab all land here.
    visits.noteVisit(host, tileId);
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
    return override() === undefined && seededPick() === tileId;
  }

  function noteSeededActivation(tileId: TerminalId): void {
    attention.clearUnread(tileId);
    noteActivation(tileId);
  }

  function reconcileLiveIds(liveIds: readonly TerminalId[]): void {
    // Empty host trail → seed with liveIds order; non-empty → membership only
    // (argument order is ignored for survivors). Kill uses forgetFromMru.
    visits.applyLiveIds(host, liveIds);
  }

  function forgetFromMru(id: TerminalId): void {
    visits.forgetVisit(host, id);
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
    setOverride(null);
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
    reconcileLiveIds,
    forgetFromMru,
    isUnread: attention.isUnread,
    canvasMaximized,
    setCanvasMaximized,
    reset,
    seedCovers,
    noteSeededActivation,
  };
}
