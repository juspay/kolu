/** Pins the host-tab dot's meaning — the unseen-finished fold, tested off id-sets
 *  without the wire. (Its sibling, the pure transition decision, is pinned in
 *  `@kolu/terminal-vocab/attentionTransitions.test.ts` since padi shares it.) */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { nextUnseenFinished } from "./unseenFinished";

const S = (...ids: string[]) => new Set(ids as TerminalId[]);

// The fold takes the ALREADY-computed transition candidates + the current
// finished ids ARRAY (observe threads in the `candidates` it already holds — no
// re-diff; the fold builds the finished lookup set itself, only when inactive).
const cand = (...c: Array<{ id: string; asking: boolean }>) =>
  c as Array<{ id: TerminalId; asking: boolean }>;
const F = (...ids: string[]) => ids as TerminalId[];

describe("nextUnseenFinished (the host-tab dot's meaning)", () => {
  // THE BUG: the dot showed for any host with a finished agent, and a finished
  // agent idles in `waiting` ~forever — so the dot was on every host, always.
  it("a STEADY finished agent is NOT unseen (no fresh candidate)", () => {
    expect(nextUnseenFinished(S(), cand(), F("a"), false)).toEqual(S());
  });

  it("a finished agent present at BASELINE (discovery, no candidates) is NOT unseen", () => {
    expect(nextUnseenFinished(S(), cand(), F("a"), false)).toEqual(S());
  });

  it("a FRESH background finish IS unseen", () => {
    expect(
      nextUnseenFinished(S(), cand({ id: "a", asking: false }), F("a"), false),
    ).toEqual(S("a"));
  });

  it("an unseen finish on the ACTIVE host clears (you're looking at it)", () => {
    expect(nextUnseenFinished(S("a"), cand(), F("a"), true)).toEqual(S());
  });

  it("an unseen finish that goes back to work drops out", () => {
    expect(nextUnseenFinished(S("a"), cand(), F(), false)).toEqual(S());
  });

  it("an unseen finish that escalates to asking drops out (it's now the amber pill)", () => {
    expect(
      nextUnseenFinished(S("a"), cand({ id: "a", asking: true }), F(), false),
    ).toEqual(S());
  });
});
