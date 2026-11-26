/** TerminalCanvas — freeform 2D canvas where tiles can be dragged and resized
 *  like desktop windows. Pan via two-finger scroll / trackpad, zoom via
 *  Ctrl+scroll / pinch. Tiles snap to the visual grid on drag end.
 *
 *  The canvas is domain-agnostic — it manages tile positioning, drag, resize,
 *  pan, and zoom. What renders inside each tile (title bar content, body) is
 *  injected via render props by the caller. Positions are read via `getLayout`
 *  and changes are reported via `onLayoutChange` — the caller owns the
 *  source of truth (today: server metadata via subscription).
 *
 *  Drag runs in the canvas's own drag scope (`dnd/`, on dnd-kit) for
 *  gesture handling — decouples sensing from position application.
 *
 *  Pan/zoom viewport logic lives in viewport/ — decomposed by volatility
 *  axis (gestures, transforms, coordinates) per Lowy analysis. */

import { sleepingArm } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  For,
  Match,
  onCleanup,
  onSettled,
  runWithOwner,
  Show,
  Switch,
  untrack,
} from "solid-js";
import type { JSX } from "@solidjs/web";
import { DragDropProvider, type DropEvent } from "../dnd";
import { savedSessionSub } from "../hostScope/activeWire";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { sameTileContent, type TileId } from "../tile/tileContent";
import { useTileStore } from "../tile/useTileStore";
import { refWithRelease } from "../ui/refWithRelease";
import { useShown } from "../ui/shown";
import CanvasMinimap from "./CanvasMinimap";
import CanvasTile, { type CanvasTileMode } from "./CanvasTile";
import Dock from "./dock/Dock";
import type { ResizeDirection } from "./resizeGeometry";
import { startTileResize, type TileResizePorts } from "./resizeGesture";
import { layoutsEqual, type TileLayout } from "./TileLayout";
import {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";
import { planTilePlacements } from "./tilePlacementPlan";
import { useCanvasCenterOnSwitch } from "./useCanvasCenterOnSwitch";
import { useCanvasFocus } from "./useCanvasFocus";
import { usePendingLayouts } from "./usePendingLayouts";
import { useTileAura } from "./useTileAura";
import { useTileTheme } from "./useTileTheme";
import { useViewPosture } from "./useViewPosture";
import {
  createContainerSizeObserver,
  useCanvasViewport,
} from "./viewport/useCanvasViewport";
import type { TilePlacement } from "../terminal/WorkspaceTerminals";

const MIN_W = 300;
const MIN_H = 200;

/** Wheel gestures that start inside an xterm tile should scroll the terminal,
 *  not pan the canvas. The viewport's ownership tracker holds this decision
 *  for ~150ms so mid-gesture cursor drift doesn't hand off. */
function isWheelTargetTerminal(e: WheelEvent): boolean {
  return e.target instanceof Element && e.target.closest(".xterm") !== null;
}

const TerminalCanvas: Component<{
  tileIds: TileId[];
  /** Saved layout for a tile, or undefined if none exists yet. */
  getLayout: (id: TileId) => TileLayout | undefined;
  /** Optional one-shot arrange trigger. When provided, the minimap
   *  zoom-bar grows an arrange button. The canvas is just plumbing —
   *  the arrange logic itself lives in `useCanvasArrange`.
   *
   *  Threaded as a prop rather than consumed via a singleton hook
   *  (the way `useCanvasViewport` and `usePendingLayouts` are read
   *  inside `CanvasMinimap`) because the arrange action is bound once
   *  at the composition root (App.tsx) and passed down — the prop
   *  captures that bound result; the minimap doesn't know or care
   *  about the arrange policy. */
  onAutoArrange?: () => void;
  /** Report a layout change (drag commit, resize commit) from a handler. */
  onLayoutChange: (id: TileId, layout: TileLayout) => void;
  /** The same write in two phases, for the DEFAULT-placement assignment the
   *  placement effect makes: the compute asks a tile for its layout writer
   *  (the sink's own reads happen there) and the effect calls the writer with
   *  the layout it just computed. An effect callback is a strict-read window,
   *  so the one-shot `onLayoutChange` cannot be used from it. */
  planLayoutChange: (id: TileId) => (layout: TileLayout) => void;
  onSelect: (id: TileId) => void;
  onClose: (id: TileId) => void;
  /** Invoked when the dock's search-icon button is clicked. Opens the
   *  command palette host-scoped (Terminals › active host) so the list is
   *  this machine's terminals only. ⌘⇧K opens Terminals (host list) instead. */
  onOpenWorkspaceSearch: () => void;
  /** Open the "new terminal" flow — wired into the dock header's `+`. */
  onCreate: () => void;
  renderTileTitle: (id: TileId) => JSX.Element;
  /** Optional title-bar actions injected between the title and the close
   *  button — e.g. the screenshot button, theme pill, agent indicator. */
  renderTileTitleActions?: (id: TileId) => JSX.Element;
  /** Optional bar between the title bar and the body — the tile tip. */
  renderTileBar?: (id: TileId) => JSX.Element;
  /** Render a tile's body, told where it stands (`TilePlacement`): whether a
   *  user can SEE this tile — the fact the pane turns into "attach / stop
   *  attaching" (`tileSeen.ts`) — whether the canvas is the view in front
   *  (false while the Conductor covers it: the tile stays attached, and
   *  states no size), and whether its box is one this canvas DECIDED
   *  (`CanvasTile`'s `boxDecided`). Accessors, not values, so the subtree
   *  doesn't remount when an answer changes: reads happen inside the
   *  returned JSX's props (fine-grained reactivity), not around the
   *  render-prop call. */
  renderTileBody: (id: TileId, placement: TilePlacement) => JSX.Element;
}> = (props) => {
  // Asked ONCE here and handed to each tile, so the tile shell keeps knowing
  // nothing about what sits on top of the canvas (`ui/shown.ts`).
  const canvasShown = useShown();
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const focus = useCanvasFocus();
  const tileTheme = useTileTheme();
  const posture = useViewPosture();
  const isStale = useStaleCheck();
  const tileAuraOf = useTileAura();

  /** Pending per-tile layout overrides — bridges the gap between local
   *  geometry intent (drag-end, resize-end, arrange) and
   *  the server metadata echo. Singleton hook so `useCanvasArrange` can
   *  seed pending for one-shot arrange writes without an imperative ref
   *  handshake. Each entry is stamped with the saved layout it was minted
   *  against, so the echo RELEASES it by arriving — in the flush that
   *  delivers it, with no write and no second pass. */
  const pendingLayouts = usePendingLayouts();
  // The gesture is minted against the layout it was COMPUTED from — `layoutOf`,
  // not the saved value. A brand-new tile's layout is the default this canvas
  // DERIVED, written through `planLayoutChange`; stamping the gesture with the
  // saved `undefined` instead would make that default's own echo read as
  // FOREIGN, and the tile would snap back out from under the pointer. No extra
  // read: drag-end, resize and the minimap already called `layoutOf(id)` for
  // the same gesture. Only the first frame's base is kept (later frames extend
  // the entry), so reading the standing override back is harmless.
  const setPendingLayout = (id: string, layout: TileLayout) =>
    pendingLayouts.setOne(id, layout, layoutOf(id));
  // A live gesture frame: nothing goes on the wire, so it must not join the
  // tile's authored trail (one entry per pointermove, never pruned).
  const previewPendingLayout = (id: string, layout: TileLayout) =>
    pendingLayouts.previewOne(id, layout, layoutOf(id));

  // Dead-tile hygiene: an entry whose tile is gone has nobody to release it.
  // That is ALL this effect does — a landed echo releases its own override
  // through `resolveLayout`, so there is no read-then-delete here to relay
  // the echo back into every layout consumer.
  createEffect(
    () => pendingLayouts.deadIds(new Set(props.tileIds)),
    (dead) => {
      pendingLayouts.dropIds(dead);
      for (const id of dead) persistedDefaults.delete(id as TileId);
    },
    // Named by hand: the compiler names no effect, so all four effects in this
    // component otherwise report at the `<TerminalCanvas>` JSX site alone.
    { name: "dropDeadPendingLayouts" },
  );

  // Pending lives at module scope (singleton, shared with useCanvasArrange).
  // Flush on canvas unmount so a mobile↔desktop remount never inherits a
  // stale entry whose echo arrived while the canvas was gone.
  onCleanup(() => pendingLayouts.clear());

  // The viewport's container is attached from the canvas div's `ref` below;
  // this component's owner measures it and hands it back.
  const containerRef = refWithRelease<HTMLDivElement>(
    (el) =>
      viewport.setContainerRef(el, {
        wheelTargetScrollsItself: isWheelTargetTerminal,
        covered: () => posture.layout() !== "tiled",
      }),
    (el) => viewport.releaseContainer(el),
  );
  createContainerSizeObserver();

  /** The tile's layout as the SERVER knows it, with a standing local gesture
   *  on top — everything except the default this canvas is about to derive
   *  for a brand-new tile. The default derivation itself reads this, so it
   *  cannot read `layoutOf` without closing a cycle. */
  function resolvedLayout(id: string): TileLayout | undefined {
    return pendingLayouts.resolveLayout(id, props.getLayout(id as TileId));
  }

  /** Effective layout for a tile: a standing pending override, else the saved
   *  layout, else the default this canvas DERIVED for it (`defaultPlacements`
   *  below) while its first `onLayoutChange` is still out. */
  function layoutOf(id: string): TileLayout | undefined {
    return resolvedLayout(id) ?? defaultPlacements().get(id as TileId);
  }

  // Per-host camera center-on-active on host switch. The decision (seed a
  // never-positioned host on its active tile, re-center a host whose tile drifted
  // out of its retained view) lives in `useCanvasCenterOnSwitch`, mounted here
  // like the sibling hooks above; its one canvas-derived input is the active
  // tile's resolved layout over the pending-layout overrides.
  const activeTileLayout = (): TileLayout | undefined => {
    const id = tileStore.activeId();
    return id ? layoutOf(id) : undefined;
  };
  useCanvasCenterOnSwitch(activeTileLayout);

  // Auto-assign a default layout for tiles with no saved position. A new
  // tile opens at the viewport-center cascade and NOTHING ELSE MOVES —
  // there is no per-create auto-arrange. Repo-island clustering happens
  // only on the explicit "Arrange canvas by repo" command (`onAutoArrange`).
  //
  // The default is DERIVED, not seeded: `defaultPlacements` is the answer
  // `layoutOf` falls back to, so the tile paints at its cascade position in
  // the very flush that makes it placeable — no (0,0) frame, and no write
  // into the state the same pass just read (which cost a second frame and
  // relayed through the minimap and the centering resolver). The effect
  // below only PERSISTS what the memo derived.
  //
  // Contract (`planTilePlacements`): default-placement stamps a layout ONLY on a
  // tile whose metadata RECORD has arrived and carries no `canvasLayout` — a
  // genuinely-new tile. A tile with no resolved layout AND no metadata record yet
  // is DEFERRED, not defaulted: it's indistinguishable from a RETURNING tile whose
  // saved layout is still in flight. That case is the host-switch split-loss bug —
  // on switch-back `terminalListSub` re-keys to the host's tiles FASTER than their
  // per-terminal `canvasLayout` metadata re-arrives, so for a beat the tiles have
  // no layout and no record; the old code stamped defaults and `onLayoutChange`
  // PERSISTED them, destroying the saved split (first-visit dodged it because the
  // snapshot carried the layout). Deferring until the record lands lets a returning
  // tile resolve its saved layout untouched.
  //
  // `allRecordsSettled` re-arms the derivation when a deferred tile's record
  // arrives (undefined -> defined). It's a BOOLEAN memo, so a metadata VALUE
  // change (agent state, cwd, git) does NOT re-derive placement — only the tile
  // set changing, the "all records arrived" edge, or a tile gaining/losing a
  // layout of its own does, keeping placement's dependency set down to the tile
  // ids (a metadata tick must not wake it).
  const isMetadataRecordPresent = (id: TileId): boolean =>
    store.getMetadata(id) !== undefined;
  const allRecordsSettled = createMemo(() =>
    props.tileIds.every(isMetadataRecordPresent),
  );
  // The ECHO edge. A tile this canvas default-placed leaves the map when its
  // own layout lands (the `onLayoutChange` write, then the server's echo), and
  // that only happens if placement WAKES on it. Counting the tiles with no
  // layout of their own is the narrowest edge that does: it ticks when a tile
  // gains or loses a layout — never when an already-placed tile's layout VALUE
  // changes, so a drag echo or a metadata tick still cannot wake placement.
  const unplacedCount = createMemo(
    () => props.tileIds.filter((id) => resolvedLayout(id) === undefined).length,
  );
  const defaultPlacements = createMemo<Map<TileId, TileLayout>>(
    (previous = new Map()) => {
      const ids = props.tileIds;
      // The three edges that may WAKE placement, and nothing else.
      void allRecordsSettled();
      void unplacedCount();
      void viewport.mounted();
      // Everything below is a SNAPSHOT taken at that edge: read untracked so a
      // camera pan or a metadata VALUE tick is not a dependency and cannot
      // wake placement.
      return untrack(() => {
        // No viewport measurement yet — defer placement; the mounted edge
        // re-derives once the observer has measured the laid-out canvas.
        // Reading the center via `viewportCenter()` (not an inlined pan+size
        // calc) keeps the unmounted-guard: a 0×0 viewport would otherwise
        // collapse the center to the raw pan origin and place tiles top-left.
        const center = viewport.viewportCenter();
        if (!center) return previous;
        const plan = planTilePlacements(
          ids,
          resolvedLayout,
          isMetadataRecordPresent,
        );
        const defaults = new Map<TileId, TileLayout>();
        const placed: TileLayout[] = [];
        for (const p of plan) {
          // Metadata record not yet arrived — wait; don't clobber a returning
          // tile's saved layout with a default.
          if (p.kind === "defer") continue;
          if (p.kind === "existing") {
            placed.push(p.layout);
            continue;
          }
          // A tile already placed on an earlier pass KEEPS its position until
          // its echo lands (at which point it resolves `existing` and leaves
          // this map). Re-deriving it against a moved camera would jump a tile
          // that has already been persisted where it stands.
          const held = previous.get(p.id);
          const layout =
            held ??
            ({
              ...findFreeTilePosition(center.x, center.y, placed),
              // The size the create flow armed, claimed by the first new tile
              // of this pass and held across re-derivations.
              ...sizeForNewTile(p.id),
            } satisfies TileLayout);
          defaults.set(p.id, layout);
          placed.push(layout);
        }
        return defaults;
      });
    },
    {
      // A placed tile's own layout landing re-derives this map (the
      // `unplacedCount` edge) and empties the tile out of it; a re-derivation
      // that changes nothing must not republish into `layoutOf` (and through
      // it the minimap's bounds and the switch-in centering resolver).
      equals: (a, b) =>
        a.size === b.size &&
        [...a].every(([id, l]) => {
          const other = b.get(id);
          return other !== undefined && layoutsEqual(l, other);
        }),
    },
  );

  // The create-time size is armed for ONE create, so exactly one tile claims
  // it: the first tile of the pass that needs a FRESH default, in
  // `props.tileIds` order — a tile already holding an earlier default never
  // asks. The arm happens before the create's own id exists
  // (`useTerminalCrud.ts:299-301`), so the slot names no tile; any other tile
  // appearing in the same pass (another client's create landing in the same
  // push, a restore) is not what the user sized from, and takes the plain
  // default.
  function sizeForNewTile(id: TileId): { w: number; h: number } {
    const inherited = pendingLayouts.claimNextDefaultSize(id);
    return {
      w: inherited?.w ?? DEFAULT_TILE_W,
      h: inherited?.h ?? DEFAULT_TILE_H,
    };
  }

  // Which derived defaults have been reported through `onLayoutChange`. A
  // plain set, not state: it answers "has this tile's first write gone out",
  // which nothing renders, and the derived default stands either way until the
  // echo replaces it. Dead ids are dropped with their pending entries above.
  //
  // A tile LEAVING the map is also recorded. It leaves for three reasons: its
  // own layout landed, a standing pending gesture now covers it, or its
  // metadata record went missing and placement DEFERS
  // (`tilePlacementPlan.ts:45`). So the next time placement derives a default
  // for it — its layout was withdrawn and it is a new tile again — that fresh
  // position must be PERSISTED too, not just painted locally. Hence the
  // compute runs (and returns work) even when there is nothing to write.
  const persistedDefaults = new Set<TileId>();
  createEffect(
    () => {
      const defaults = defaultPlacements();
      return untrack(() => {
        const writes = [...defaults]
          .filter(([id]) => !persistedDefaults.has(id))
          // The sink resolves the tile HERE, in the compute; the effect, which
          // may read nothing, only calls the writer with the derived layout.
          .map(
            ([id, layout]) =>
              ({ id, layout, write: props.planLayoutChange(id) }) as const,
          );
        const placed = [...persistedDefaults].filter((id) => !defaults.has(id));
        // Nothing to write: no active tile to read, and no landing to plan.
        const activeId = writes.length > 0 ? tileStore.activeId() : null;
        return {
          writes,
          placed,
          activeId,
          // The landing is PLANNED here, where its reads (the tile's
          // remembered pane, its split's state) belong; the effect below only
          // runs the thunk, and only if the active tile is one it just placed.
          landActive: activeId
            ? tileStore.planActivateVisiblePane(activeId)
            : null,
        };
      });
    },
    (work) => {
      // The reported default is published to the pending singleton as it goes
      // out, and dropped when the tile leaves the map, so a gesture raised
      // outside this component (`useCanvasArrange`'s reset) can mint against
      // the layout the tile is SHOWING — this component's `layoutOf`.
      //
      // The BOOKKEEPING stays synchronous: `persistedDefaults` is the guard
      // that keeps one tile's default from being planned twice, so it must
      // record the write the moment it is queued, not when it drains.
      for (const id of work.placed) persistedDefaults.delete(id);
      for (const { id } of work.writes) persistedDefaults.add(id);
      // SETTLED, not inline: `write` lands in the tile's metadata record
      // (`state.<terminal-uuid>`), which `useTerminalStore`'s `webglTileBudget`
      // reads — so an inline write from this arm relays into a memo that has
      // already run this flush (`EFFECT_RELAY_TEAR`, the dev lane's largest
      // advisory). From `onSettled` the whole write phase lands in a later pass
      // of the SAME flush — no extra frame, the same order — carrying no effect
      // origin.
      //
      // UNOWNED: with an owner, `onSettled` is a tracked effect created and run
      // right there, which would carry this arm's frame and grow a child per
      // pass. With no owner it enqueues, which is the deferral. The callback is
      // a BLOCK that returns nothing: an unowned `onSettled` reads a returned
      // value as a cleanup and throws from the drain.
      runWithOwner(null, () =>
        onSettled(() => {
          for (const id of work.placed) pendingLayouts.forgetDerivedDefault(id);
          for (const { id, layout, write } of work.writes) {
            pendingLayouts.publishDerivedDefault(id, layout);
            write(layout);
          }
          // Pan to the active newly-placed tile. This is a tile-level landing
          // with no explicit pane target, so it preserves the visible
          // remembered pane; the call's job is bumping the centering signal
          // once the new tile's layout is derivable. Same mechanism the
          // `focus.request` effect below uses for every other system-driven
          // activation.
          const { activeId, landActive } = work;
          if (
            landActive &&
            activeId &&
            work.writes.some((w) => w.id === activeId)
          )
            landActive();
        }),
      );
    },
    { name: "persistDerivedDefaults" },
  );

  /** Apply the drag's offset to the tile's persisted position.
   *  The offset is in screen-space — normalize by zoom for canvas-space. */
  function handleDragEnd({ sourceId: id, transform }: DropEvent) {
    const l = layoutOf(id);
    if (!l) return;
    if (transform.x === 0 && transform.y === 0) return;
    const { dx, dy } = viewport.normalizeDelta(transform.x, transform.y);
    const next: TileLayout = {
      ...l,
      x: viewport.snapToGrid(l.x + dx),
      y: viewport.snapToGrid(l.y + dy),
    };
    // Hold pending until metadata echo arrives — avoids a frame where the
    // drag's transform has reset to 0 but getLayout still returns the
    // pre-drag position.
    setPendingLayout(id, next);
    props.onLayoutChange(id, next);
  }

  /** Start resizing a tile from the given edge or corner. The gesture is
   *  `resizeGesture.ts`'s; the canvas answers what it alone knows — the live
   *  layout, the zoom the pointer delta is normalized by, the grid, and where
   *  a committed layout goes. */
  let abortResize: AbortController | null = null;
  const resizePorts: TileResizePorts = {
    limits: { minW: MIN_W, minH: MIN_H },
    layoutOf,
    normalizeDelta: viewport.normalizeDelta,
    snapToGrid: viewport.snapToGrid,
    hasPending: (id) =>
      pendingLayouts.hasOverride(id, props.getLayout(id as TileId)),
    // `onMove` frames are previews — held locally, never reported.
    setPending: previewPendingLayout,
    commit: (id, layout) => {
      setPendingLayout(id, layout);
      props.onLayoutChange(id as TileId, layout);
    },
  };
  function startResize(
    id: string,
    direction: ResizeDirection,
    e: PointerEvent,
  ) {
    abortResize =
      startTileResize(e, id, direction, abortResize, resizePorts) ??
      abortResize;
  }

  // No `defer: true`: the cascade effect bumps the signal during canvas
  // mount and on a remount (close-all → re-create) it can register
  // before this effect installs its tracker. Without defer the initial
  // run sees the bumped payload; a stale id from a prior mount resolves
  // to `layoutOf(id) === undefined` (the tile is gone) so the initial
  // run is a safe no-op.
  createEffect(
    () => {
      const id = focus.request();
      // The layout is read untracked: the REQUEST is the edge this effect
      // follows, and a later layout change for that tile is not a second pan.
      return id ? untrack(() => layoutOf(id)) : undefined;
    },
    (layout) => {
      if (layout) requestAnimationFrame(() => viewport.centerOnTile(layout));
    },
    { name: "centerOnFocusRequest" },
  );

  // On first mount at the default origin, pan so the persisted active tile
  // is centered (matches what a workspace-switcher click does). If there's no
  // active tile, fall back to centering the bounding box of all tiles so
  // restored sessions whose tiles live far from (0,0) don't open empty.
  const isDefaultViewport = () =>
    viewport.panX() === 0 && viewport.panY() === 0 && viewport.zoom() === 1;

  type CenterTarget =
    | { kind: "tile"; layout: TileLayout }
    | { kind: "bbox"; x: number; y: number };
  createEffect(
    (): CenterTarget | null => {
      const ids = props.tileIds;
      // The centering impulse is DROPPED, not deferred, while the viewport has no
      // measured size (`targetForTile` answers null) — and nothing re-fires it, so
      // a slow first measurement (a loaded CI box, a busy tab) left a restored
      // session uncentered for the rest of the session. Wait for the first
      // measurement: reading `mounted()` also makes this effect re-run when it
      // lands, which is the retry the drop never had.
      if (!viewport.mounted()) return null;
      if (ids.length === 0 || !isDefaultViewport()) return null;
      // Wait for the active id to hydrate before deciding between "centre on
      // saved active" and "bbox fallback". Running the bbox fallback while the
      // active is still in flight pans the viewport off-default, and the
      // `isDefaultViewport()` guard above then blocks any re-centre once
      // `useSessionRestore` calls `setActiveSilently` with the persisted id —
      // leaving a restored session centred on the bbox instead of its active tile.
      //
      // TWO windows produce "tiles present, active not yet assigned":
      //   - COLD LOAD: `terminalList.get` (which feeds `tileIds`) beats
      //     `session.get`, so `session` is still `pending()`.
      //   - RESTORE FROM CARD (W1.R6): `session.get` has ALREADY yielded (the card
      //     needed it), so `pending()` is false — but the restored tiles arrive on
      //     the `terminals` collection AFTER the click, and `useSessionRestore`'s
      //     hydration assigns the active a tick later. A `pending()`-only guard
      //     misses this window.
      // So wait whenever there's no active yet AND one is expected — either the
      // session snapshot is still in flight, or it names an `activeTerminalId`.
      // Hydration always assigns SOME active when top-level tiles exist (it falls
      // back to the first tile), so this can't wait forever.
      const savedActiveId = savedSessionSub()?.activeTerminalId ?? null;
      if (
        tileStore.activeId() === null &&
        (savedSessionSub.pending() || savedActiveId !== null)
      )
        return null;
      const active = tileStore.activeId();
      const activeLayout = active ? layoutOf(active) : undefined;
      if (activeLayout) return { kind: "tile", layout: activeLayout };
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const id of ids) {
        const l = layoutOf(id);
        if (!l) continue;
        minX = Math.min(minX, l.x);
        minY = Math.min(minY, l.y);
        maxX = Math.max(maxX, l.x + l.w);
        maxY = Math.max(maxY, l.y + l.h);
      }
      if (!Number.isFinite(minX)) return null;
      return { kind: "bbox", x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    },
    // The pan itself is the imperative half: one frame later, so the canvas has
    // laid out at its new size before the camera moves.
    (target) => {
      if (!target) return;
      requestAnimationFrame(() => {
        if (target.kind === "tile") viewport.centerOnTile(target.layout);
        else viewport.panTo(target.x, target.y);
      });
    },
    { name: "centerOnFirstMount" },
  );

  /** Render a live-terminal tile. Driven by two id faces that coincide today
   *  (`tileId === terminalId`) but are split to make the seam explicit: the
   *  tile's IDENTITY (active selection, drag/resize key, render props) vs. its
   *  terminal's CONTENT (display info, theme, staleness, run-state aura). PR 2's
   *  sleeping arm renders a frozen body off the same `tileId` with no terminal. */
  function renderTerminalTile(
    tileId: TileId,
    terminalId: () => TerminalId,
  ): JSX.Element {
    const active = () => tileStore.isActiveTile(tileId);
    const mode = (): CanvasTileMode =>
      posture.layout() === "tiled"
        ? "tiled"
        : active()
          ? "maximized"
          : "covered";
    return (
      <Show when={store.getDisplayInfo(terminalId())}>
        {(info) => (
          <CanvasTile
            id={tileId}
            active={active()}
            mode={mode()}
            dimmed={isStale(
              store.getMetadata(terminalId())?.lastActivityAt ?? 0,
            )}
            sleeping={
              sleepingArm(store.getMetadata(terminalId())) !== undefined
            }
            theme={tileTheme(terminalId())}
            repoColor={info().repoColor}
            onSelect={() => props.onSelect(tileId)}
            onClose={() => props.onClose(tileId)}
            onToggleMaximize={posture.toggle}
            renderTitle={() => props.renderTileTitle(tileId)}
            renderTitleActions={
              props.renderTileTitleActions
                ? () => props.renderTileTitleActions?.(tileId)
                : undefined
            }
            renderBar={() => props.renderTileBar?.(tileId)}
            renderBody={(seen, boxDecided) =>
              props.renderTileBody(tileId, {
                seen,
                viewShown: canvasShown,
                boxDecided,
              })
            }
            getLayout={layoutOf}
            startResize={startResize}
            panX={viewport.panX}
            panY={viewport.panY}
            zoom={viewport.zoom}
            viewportSize={() =>
              viewport.mounted() ? viewport.viewportSize() : undefined
            }
            viewShown={canvasShown}
            cameraSettled={viewport.cameraSettled}
            auraTier={() => tileAuraOf(terminalId())}
          />
        )}
      </Show>
    );
  }

  return (
    <DragDropProvider onDragEnd={handleDragEnd}>
      {/* Outer flex container — single mount point for the activity
       *  dock. The dock owns its own posture-conditional positioning:
       *  in maximized mode it's `relative shrink-0` (real left-panel
       *  flex sibling — the canvas takes the remaining width via
       *  `flex-1`); in tiled mode it's `absolute z-30 top-16 left-4`
       *  (floats over the canvas). The wrapper is `relative` so the
       *  dock's absolute coordinates in tiled mode resolve to the same
       *  `top: 5rem, left: 1rem` they did when mounted inside the
       *  canvas div.
       *  Mounting the dock once instead of toggling between two
       *  `<Show>` branches avoids tearing down its reactive scope on
       *  posture flips — the prior split-mount approach left the dock
       *  invisible until full page reload after enough toggles
       *  (#909 follow-up bug report). */}
      <div class="flex-1 min-h-0 overflow-hidden flex relative">
        <Dock
          onOpenWorkspaceSearch={props.onOpenWorkspaceSearch}
          onCreate={props.onCreate}
        />
        {/* The viewport COLUMN. One shape, always — so the canvas element
         *  below is created once for the life of the workspace: re-parenting
         *  it would re-create every tile under it, and with them every xterm
         *  buffer and every attach. */}
        <div class="flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            ref={containerRef}
            data-testid="canvas-container"
            data-zoom={viewport.zoom()}
            data-viewport={viewport.canvasTransform()}
            class="flex-1 min-w-0 overflow-hidden relative canvas-grid-bg"
            style={{
              "background-position": viewport.gridBgPosition(),
              "background-size": viewport.gridBgSize(),
            }}
            // Double-click the bare surface to open the "new terminal" flow —
            // the same `onCreate` the dock's `+` reaches, so the empty canvas
            // is itself an affordance for spawning a terminal. Guarded to the
            // background (`target === currentTarget`): a double-click on a tile's
            // BODY or on the minimap bubbles up here with `target !== currentTarget`,
            // and the guard keeps create to the bare surface. (A title-bar
            // double-click never reaches here — CanvasTile's own dblclick handler
            // stopPropagation's after it maximizes.)
            onDblClick={(e) => {
              if (e.target === e.currentTarget) props.onCreate();
            }}
          >
            {/* All tiles render in one stable list, every render. Pan/zoom
             *  composes into each tile's own `transform` (CanvasTile), so
             *  there's no wrapper transform — which means the active tile in
             *  maximized mode can use `absolute inset-0 z-40` to cover the
             *  canvas without a containing-block trap. Switching activeId in
             *  maximized mode reduces to a CSS class reshuffle on already-
             *  mounted tiles: no Terminal remount, no `document.fonts.load`,
             *  no stream re-attach, no scrollback replay (#988).
             *
             *  `data-viewport` on `canvas-container` carries the pan/zoom-only
             *  CSS string so tests can observe viewport state independently of
             *  per-tile transforms (which also fold in layout coords + drag). */}
            <For each={props.tileIds}>
              {(id) => {
                // The one content-kind dispatch: a tile renders by WHAT IT HOLDS,
                // never by its liveness. `<Switch>` / `<Match when={kind === …}>`
                // keys each arm on a STABLE boolean (not `match(content())`, which
                // would re-create the tile subtree every tick), the same
                // discipline App.tsx's canvas-mode <Switch> relies on. Today the
                // only kind is `terminal`; PR 2 adds a `sleeping` arm here and
                // inherits drag / resize / focus / active for free.
                // Memoised on the content's OWN equality: `contentOf` answers a
                // fresh object per call over the tracked tile set, so a plain
                // accessor re-published the whole dispatch — the `<Show>`'s
                // condition and the `<Match>`'s — on every tile add and remove.
                const content = createMemo(() => tileStore.contentOf(id), {
                  equals: sameTileContent,
                });
                return (
                  <Show when={content()}>
                    {(c) => (
                      <Switch>
                        <Match when={c().kind === "terminal" && c()}>
                          {(terminal) =>
                            renderTerminalTile(id, () => terminal().terminalId)
                          }
                        </Match>
                      </Switch>
                    )}
                  </Show>
                );
              }}
            </For>

            <Show when={viewport.mounted()}>
              {/* Minimap: spatial dashboard; hides in fullscreen-single-tile mode
               *  since there's nothing spatial to summarize. */}
              <div
                class={{ hidden: posture.layout() !== "tiled" }}
                inert={posture.layout() !== "tiled"}
              >
                <CanvasMinimap
                  shown={posture.layout() === "tiled"}
                  tileIds={props.tileIds}
                  getLayout={layoutOf}
                  onSelect={props.onSelect}
                  onAutoArrange={props.onAutoArrange}
                  onStartTileDrag={(id) => {
                    const origin = layoutOf(id);
                    if (!origin) return null;
                    return {
                      preview: (dx, dy) =>
                        previewPendingLayout(id, {
                          ...origin,
                          x: origin.x + dx,
                          y: origin.y + dy,
                        }),
                      commit: (dx, dy) => {
                        const next: TileLayout = {
                          ...origin,
                          x: viewport.snapToGrid(origin.x + dx),
                          y: viewport.snapToGrid(origin.y + dy),
                        };
                        setPendingLayout(id, next);
                        props.onLayoutChange(id, next);
                      },
                    };
                  }}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
    </DragDropProvider>
  );
};

export default TerminalCanvas;
