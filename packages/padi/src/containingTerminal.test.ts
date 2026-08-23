/**
 * Pins the self-identity read: the three arms of the stamp, and that a garbled
 * one is REFUSED rather than guessed at. padi answers what the stamp said; what
 * a refusal reads like is each face's own sentence, pinned at each face.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { confirmInFleet, containingTerminalId } from "./containingTerminal.ts";

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const LANE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;

describe("containingTerminalId — KAVAL_TERMINAL_ID, or none", () => {
  it("is none when the env does not name a terminal", () => {
    expect(containingTerminalId({})).toEqual({ kind: "none" });
    expect(containingTerminalId({ KAVAL_TERMINAL_ID: "" })).toEqual({
      kind: "none",
    });
  });

  it("is this terminal when the env carries a real id", () => {
    expect(containingTerminalId({ KAVAL_TERMINAL_ID: SELF })).toEqual({
      kind: "ok",
      id: SELF,
    });
  });

  it("is invalid rather than a guess when the stamp is not a terminal id", () => {
    expect(containingTerminalId({ KAVAL_TERMINAL_ID: "not-a-uuid" })).toEqual({
      kind: "invalid",
      raw: "not-a-uuid",
    });
  });
});

describe("confirmInFleet — the fourth arm, and the one both faces switch on", () => {
  it("keeps the ok arm when the padi owns the stamped terminal", () => {
    expect(confirmInFleet({ kind: "ok", id: SELF }, [SELF, LANE])).toEqual({
      kind: "ok",
      id: SELF,
    });
  });

  it("is STRAY when this padi has never heard of it", () => {
    // What `kolu watch --ignore-self` and `watch_open`'s `ignoreSelf` both
    // refuse, off this ONE arm: muting a terminal nobody here has heard of
    // would mute nobody and report success. `--host`, a `--socket` aimed at a
    // sibling padi, and a stamp re-keyed by a daemon restart all land here.
    expect(confirmInFleet({ kind: "ok", id: SELF }, [LANE])).toEqual({
      kind: "stray",
      id: SELF,
    });
  });

  it("passes the other two arms through untouched — a roster cannot rescue them", () => {
    expect(confirmInFleet({ kind: "none" }, [SELF])).toEqual({ kind: "none" });
    expect(confirmInFleet({ kind: "invalid", raw: "nope" }, [SELF])).toEqual({
      kind: "invalid",
      raw: "nope",
    });
  });
});
