import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { nextUnseenFinished } from "./unseenFinished";

const S = (...ids: string[]) => new Set(ids as TerminalId[]);

const cand = (...c: Array<{ id: string; asking: boolean }>) =>
  c as Array<{ id: TerminalId; asking: boolean }>;
const F = (...ids: string[]) => ids as TerminalId[];

describe("nextUnseenFinished (the host-tab dot's meaning)", () => {
  it("a STEADY finished agent is NOT unseen (no fresh candidate)", () => {
    expect(
      nextUnseenFinished({
        unseen: S(),
        candidates: cand(),
        finishedIds: F("a"),
        isActiveHost: false,
      }),
    ).toEqual(S());
  });

  it("a finished agent present at BASELINE (discovery, no candidates) is NOT unseen", () => {
    expect(
      nextUnseenFinished({
        unseen: S(),
        candidates: cand(),
        finishedIds: F("a"),
        isActiveHost: false,
      }),
    ).toEqual(S());
  });

  it("a FRESH background finish IS unseen", () => {
    expect(
      nextUnseenFinished({
        unseen: S(),
        candidates: cand({ id: "a", asking: false }),
        finishedIds: F("a"),
        isActiveHost: false,
      }),
    ).toEqual(S("a"));
  });

  it("an unseen finish on the ACTIVE host clears (you're looking at it)", () => {
    expect(
      nextUnseenFinished({
        unseen: S("a"),
        candidates: cand(),
        finishedIds: F("a"),
        isActiveHost: true,
      }),
    ).toEqual(S());
  });

  it("an unseen finish that goes back to work drops out", () => {
    expect(
      nextUnseenFinished({
        unseen: S("a"),
        candidates: cand(),
        finishedIds: F(),
        isActiveHost: false,
      }),
    ).toEqual(S());
  });

  it("an unseen finish that escalates to asking drops out (it's now the amber pill)", () => {
    expect(
      nextUnseenFinished({
        unseen: S("a"),
        candidates: cand({ id: "a", asking: true }),
        finishedIds: F(),
        isActiveHost: false,
      }),
    ).toEqual(S());
  });
});
