import type { TerminalId } from "kolu-common/surface";
import { expect, it } from "vitest";
import { isTerminalWatched } from "./attentionWatched";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "the-split" as TerminalId;

it("treats the focused split, rather than its parent tile, as watched", () => {
  expect(isTerminalWatched(true, SPLIT, SPLIT, true)).toBe(true);
  expect(isTerminalWatched(true, PARENT, SPLIT, true)).toBe(false);
});
