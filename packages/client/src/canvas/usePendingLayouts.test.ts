/** AN EQUAL ECHO SETTLES IN ONE PASS.
 *
 * A pending layout is a local gesture held until the server echoes it back.
 * The echo used to be RELEASED BY A WRITE: an effect read the pending store,
 * saw the saved layout catch up, and deleted the entry — a write into state the
 * same pass had just read, which republished every layout consumer (the
 * canvas's `layoutOf`, the minimap's bounds, the switch-in centering resolver)
 * a second time for a value that had not changed.
 *
 * Each entry now carries every saved value this client AUTHORED, so the echo
 * releases it by arriving: `resolveLayout` stops preferring the override the
 * moment the saved value equals it, in the flush that delivers it, with nobody
 * writing anything. A saved value this client authored earlier (the base, or a
 * gesture a later one superseded) is that earlier write catching up and leaves
 * the newest gesture standing; a FOREIGN saved value wins at once.
 */

import type { TerminalId } from "kolu-common/surface";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { beforeEach, expect, it } from "vitest";
import type { TileLayout } from "./TileLayout";
import { usePendingLayouts } from "./usePendingLayouts";

const ID = "tile-1" as TerminalId;
const SAVED: TileLayout = { x: 0, y: 0, w: 300, h: 200 };
const DRAGGED: TileLayout = { x: 120, y: 80, w: 300, h: 200 };

/** The store is a singleton — start each test from a clean slate, outside any
 *  owner (the wipe is a write). */
beforeEach(() => usePendingLayouts().clear());

/** The canvas's two consumers of the module, as the canvas wires them: a
 *  layout read, and the dead-tile hygiene pass. */
function mountCanvasSide(saved: () => TileLayout | undefined) {
  const pending = usePendingLayouts();
  const published: (TileLayout | undefined)[] = [];
  createEffect(
    () => pending.resolveLayout(ID, saved()),
    (layout) => {
      published.push(layout);
    },
  );
  createEffect(
    () => pending.deadIds(new Set([ID])),
    (dead) => {
      pending.dropIds(dead);
    },
  );
  return { pending, published };
}

it("releases an override in the flush its echo lands, without a second pass", () => {
  // Mount inside a root, then drive from OUTSIDE it: every write here stands
  // for a user gesture or a server push, neither of which runs under an owner.
  const canvas = createRoot((dispose) => {
    const [saved, setSaved] = createSignal<TileLayout | undefined>(SAVED);
    return { ...mountCanvasSide(saved), saved, setSaved, dispose };
  });
  flush();

  canvas.pending.setOne(ID, DRAGGED, canvas.saved());
  flush();
  expect(canvas.published.at(-1)).toEqual(DRAGGED); // the gesture stands
  const beforeEcho = canvas.published.length;

  canvas.setSaved(DRAGGED); // the server's echo
  flush();

  expect(canvas.published.length).toBe(beforeEcho + 1); // ONE pass, not two
  expect(canvas.published.at(-1)).toEqual(DRAGGED);
  // Released by the echo alone — no cleanup write is owed.
  expect(canvas.pending.hasOverride(ID, DRAGGED)).toBe(false);
  canvas.dispose();
});

it("holds the override until its own echo arrives", () => {
  const canvas = createRoot((dispose) => {
    const [saved, setSaved] = createSignal<TileLayout | undefined>(SAVED);
    return { ...mountCanvasSide(saved), saved, setSaved, dispose };
  });
  flush();

  canvas.pending.setOne(ID, DRAGGED, canvas.saved());
  flush();
  // A metadata republish that is NOT this gesture's echo (same layout, fresh
  // object) leaves the gesture standing.
  canvas.setSaved({ ...SAVED });
  flush();

  expect(canvas.published.at(-1)).toEqual(DRAGGED);
  expect(canvas.pending.hasOverride(ID, canvas.saved())).toBe(true);
  canvas.dispose();
});

it("keeps the newest gesture when a superseded one echoes", () => {
  const canvas = createRoot((dispose) => {
    const [saved, setSaved] = createSignal<TileLayout | undefined>(SAVED);
    return { ...mountCanvasSide(saved), saved, setSaved, dispose };
  });
  flush();

  // Two gestures minted against the same base — e.g. arrange, then a drag
  // before the arrange has echoed.
  const L1 = DRAGGED;
  const L2: TileLayout = { x: 400, y: 260, w: 300, h: 200 };
  canvas.pending.setOne(ID, L1, canvas.saved());
  canvas.pending.setOne(ID, L2, canvas.saved());
  flush();
  expect(canvas.published.at(-1)).toEqual(L2);

  // L1's echo lands: this client's own earlier write catching up, so the
  // tile must NOT jump back to it.
  canvas.setSaved(L1);
  flush();
  expect(canvas.published.at(-1)).toEqual(L2);
  expect(canvas.pending.hasOverride(ID, L1)).toBe(true);

  // L2's own echo releases it.
  canvas.setSaved(L2);
  flush();
  expect(canvas.published.at(-1)).toEqual(L2);
  expect(canvas.pending.hasOverride(ID, L2)).toBe(false);
  canvas.dispose();
});

it("lets a foreign layout win over a standing gesture", () => {
  const canvas = createRoot((dispose) => {
    const [saved, setSaved] = createSignal<TileLayout | undefined>(SAVED);
    return { ...mountCanvasSide(saved), saved, setSaved, dispose };
  });
  flush();

  canvas.pending.setOne(ID, DRAGGED, canvas.saved());
  flush();
  // Nobody here authored this: another client moved the tile.
  const FOREIGN: TileLayout = { x: -90, y: 40, w: 300, h: 200 };
  canvas.setSaved(FOREIGN);
  flush();

  expect(canvas.published.at(-1)).toEqual(FOREIGN);
  expect(canvas.pending.hasOverride(ID, FOREIGN)).toBe(false);
  canvas.dispose();
});

/** The create-time size slot is armed for ONE create, so only the tile that
 *  create made inherits it — a second new tile in the same placement pass
 *  takes the canvas default. The claim is stamped into the record, so the
 *  claiming tile keeps the size across re-derivations of the memo. */
it("gives the armed create size to the created tile only", () => {
  const pending = usePendingLayouts();
  const created = "tile-created" as TerminalId;
  const other = "tile-other" as TerminalId;
  pending.setNextDefaultSize({ w: 640, h: 480 });

  expect(pending.claimNextDefaultSize(created)).toEqual({ w: 640, h: 480 });
  expect(pending.claimNextDefaultSize(other)).toBeNull();
  // Idempotent across re-runs of the derivation.
  expect(pending.claimNextDefaultSize(created)).toEqual({ w: 640, h: 480 });
  expect(pending.claimNextDefaultSize(other)).toBeNull();
});
