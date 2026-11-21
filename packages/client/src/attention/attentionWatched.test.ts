import type { TerminalId } from "kolu-common/surface";
import { expect, it } from "vitest";
import { isInFront } from "./attentionWatched";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "the-split" as TerminalId;

const at = (over: Partial<Parameters<typeof isInFront>[0]> = {}) =>
  isInFront({
    canvasShown: true,
    activeHost: true,
    id: SPLIT,
    focusedId: SPLIT,
    screenShowing: false,
    ...over,
  });

it("treats the focused split, rather than its parent tile, as in front", () => {
  expect(at()).toBe(true);
  expect(at({ id: PARENT })).toBe(false);
});

it("puts no pane of a host you are not on in front", () => {
  expect(at({ activeHost: false })).toBe(false);
});

it("takes the focused pane out of front while the Conductor covers the canvas", () => {
  expect(at({ canvasShown: false })).toBe(false);
});

it("puts a terminal whose screen shows in the Conductor in front, on any host", () => {
  expect(
    at({
      canvasShown: false,
      activeHost: false,
      id: PARENT,
      screenShowing: true,
    }),
  ).toBe(true);
});
