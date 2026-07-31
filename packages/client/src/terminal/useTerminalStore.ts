/** Terminal store — composes view state and metadata.
 *
 *  Server-derived state streams through `terminalListSub` — a window over the
 *  active host's RETAINED terminal-keys stream, in `hostScope/activeWire.ts`
 *  (W9; it left `wire.ts` when the per-host wire subs became retained); client
 *  view state (activeId, attention, mruOrder) lives in local signals.
 *
 *  Singleton via `createSharedRoot`: every consumer (command palette,
 *  ChromeBar, TerminalCanvas, dock, mobile sheet, tile theme) reads the same
 *  store, so derivations like `getDisplayInfo` and `getMetadata` flow
 *  without prop-drilling lookup functions through layout components. */

import { activeArm } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { useViewState } from "../useViewState";
import { terminalListSub } from "../hostScope/activeWire";
import { useTileFocus } from "./useTileFocus";
import { useTerminalMetadata } from "./useTerminalMetadata";
import {
  admitWebglTiles,
  isActiveSplit,
  tileWebglCost,
  WEBGL_CONTEXT_CAP,
} from "./webglBudget";

export const useTerminalStore = createSharedRoot(() => {
  const view = useViewState();
  const metadata = useTerminalMetadata({
    list: terminalListSub,
  });
  const tileFocus = useTileFocus();

  /** The terminal currently receiving input, narrowed to a live PTY. The focus
   *  identity itself is the per-host fact in `createViewState`; this accessor
   *  adds only the active-arm gate required by input-routing callers. */
  function focusedId(): TerminalId | null {
    const resolved = view.focusedTerminalId();
    if (resolved === null) return null;
    // A sleeping tile can be the active/selected tile, but it has no live PTY —
    // it is never an input target. Narrow to the active arm so every input-
    // routing site (mobile key bar, copy-pane-text, run-in-active-terminal)
    // falls back to "no target" rather than writing into a released PTY.
    return activeArm(metadata.getMetadata(resolved)) ? resolved : null;
  }

  /** The tiles entitled to a WebGL context: the most-recently-active *live*
   *  tiles that fit under `WEBGL_CONTEXT_CAP`. Derived from the tile MRU
   *  (`mruOrder`) intersected with the live top-level tiles, so a closed tile is
   *  dropped rather than pinning a slot — no explicit remove-on-close needed.
   *  Reactive, so switching tiles loads/unloads WebGL only on the tiles that
   *  cross the cap boundary; when the whole working set fits, focus switches
   *  churn nothing (the #1399 fix). */
  const webglTileBudget = createMemo(() => {
    // `terminalIds()` includes sleeping tiles (they are full canvas citizens —
    // they render, drag, and sit in the MRU), but a sleeping terminal holds NO
    // live resource, so it must never claim a WebGL context. Narrowing the budget
    // input to the active arm is the single gate that keeps the budget on the
    // active arm; `holdsWebgl` inherits it via `budget.includes`.
    const live = new Set(
      metadata
        .terminalIds()
        .filter((id) => activeArm(metadata.getMetadata(id)) !== undefined),
    );
    const ordered = view.mruOrder().filter((id) => live.has(id));
    // Every tile is exactly one PTY now, so every tile costs exactly one
    // context — admitting the full working set churn-free (#1399) while staying
    // under Chrome's per-tab limit (#575).
    return admitWebglTiles(ordered, () => 1, WEBGL_CONTEXT_CAP);
  });

  /** Whether `id` should hold a WebGL renderer under the budget. A tile is one
   *  terminal, so this is simply budget membership. Note it diverges from "is
   *  focused" — an unfocused budgeted tile keeps WebGL — so it stays distinct
   *  from the `isFocused` gate that drives zoom and `data-focused`. */
  function holdsWebgl(id: TerminalId): boolean {
    return webglTileBudget().includes(id);
  }

  // Bundle the active terminal id with ITS OWN metadata so a consumer gets a
  // consistent (id, meta) pair from one reactive read. Handed to the right panel
  // as two separate sources — the activeId signal and the activeMeta memo — they
  // can tear on a terminal switch (the new active id paired with the PREVIOUS
  // terminal's metadata for a propagation step), which makes CodeTab's repo-
  // change reset wipe the new terminal's Code-tab history (a darwin-only flake
  // under parallel-worker load). Reading getMetadata(id) for the bundled id is
  // glitch-free.
  const active = createMemo(() => {
    const id = view.activeId();
    return {
      id,
      meta: id !== null ? (metadata.getMetadata(id) ?? null) : null,
    };
  });

  // The loose meta-only accessor is a thin view over the bundled pair — the one
  // computation of "meta for the active terminal". An imperative reader (command
  // palette, keyboard handler, tip gating) that needs only the cwd/agent reads
  // this; a reactive consumer that pairs it with the id MUST read `active` so the
  // pair stays glitch-free. Defining it off `active` rather than as a second
  // `activeId -> meta` memo guarantees there is no separate tear-prone derivation
  // to fall into.
  const activeMeta = () => active().meta;

  /** Select a tile without panning. Any terminal is a legal target — a child
   *  is a first-class tile now, not a pane hidden inside its parent. */
  function setActiveSilently(id: TerminalId | null): void {
    if (id === null) {
      tileFocus.clearFocus();
      return;
    }
    tileFocus.focusTerminal(id);
  }

  /** Select a top-level tile and ask the canvas to center it. */
  function activate(id: TerminalId | null): void {
    setActiveSilently(id);
    if (id !== null) view.requestCenterActive();
  }

  /** Land on a tile and center it. Every terminal is a tile, so there is no
   *  longer a "this id is a split" caller error to raise. */
  function focusMainTerminal(id: TerminalId): void {
    tileFocus.focusTerminal(id);
    view.requestCenterActive();
  }

  /** Land on any terminal without asking a canvas to pan. Touch layouts use
   *  this because they own no canvas; desktop composes centering below. */
  function focusTerminalSilently(id: TerminalId): void {
    const record = metadata.getMetadata(id);
    if (!record)
      throw new Error(`focusTerminalSilently: no terminal metadata for ${id}`);
    tileFocus.focusTerminal(id);
  }

  /** Land on any terminal and ask the desktop canvas to center its tile. */
  function focusTerminal(id: TerminalId): void {
    focusTerminalSilently(id);
    view.requestCenterActive();
  }

  return {
    // Live terminal list from server (Subscription<TerminalInfo[]>).
    listSub: terminalListSub,
    // The active terminal id bundled with its own metadata (a consistent pair).
    active,
    // Meta-only view over the pair (imperative readers needing just cwd/agent).
    activeMeta,
    // View state
    ...view,
    // Server metadata + activity + derived ordering
    ...metadata,
    // Public top-level selection resolves remembered pane chrome before writing
    // the one focus fact; the raw view writers stay internal to this composer.
    activate,
    setActiveSilently,
    // The input-routing target (tile root, or its focused split).
    focusedId,
    // Landing verbs for either a top-level terminal or a split: touch-safe
    // without panning, or desktop with a centering request.
    focusTerminalSilently,
    focusTerminal,
    focusMainTerminal,
    // WebGL budget: whether a terminal should hold a WebGL renderer (#1403).
    holdsWebgl,
    // Lifecycle (view-state only — list is server-driven)
    reset: view.reset,
  };
});

export type TerminalStore = ReturnType<typeof useTerminalStore>;
