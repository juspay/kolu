/** AN EQUAL ECHO SETTLES IN ONE PASS.
 *
 * A pending layout is a local gesture held until the server echoes it back.
 * The echo used to be RELEASED BY A WRITE: an effect read the pending store,
 * saw the saved layout catch up, and deleted the entry — a write into state the
 * same pass had just read, which republished every layout consumer (the
 * canvas's `layoutOf`, the minimap's bounds, the switch-in centering resolver)
 * a second time for a value that had not changed.
 *
 * Each entry now carries the saved layout it was MINTED against, so the echo
 * releases it by arriving: `resolveLayout` stops preferring the override the
 * moment the saved value differs from that base, in the flush that delivers it,
 * with nobody writing anything.
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
