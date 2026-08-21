/**
 * Pins the self-identity read: the three arms of the stamp, and that a garbled
 * one is REFUSED rather than guessed at. padi answers what the stamp said; what
 * a refusal reads like is each face's own sentence, pinned at each face.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { containingTerminalId } from "./containingTerminal.ts";

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;

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
