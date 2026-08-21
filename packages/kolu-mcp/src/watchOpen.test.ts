/**
 * Pins `watch_open`'s ignoreSelf resolution — the face-level half. padi never
 * sees the boolean: this process either names its containing terminal as an
 * ignore id, or refuses the param.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { ToolFailure } from "@kolu/surface-mcp";
import { describe, expect, it } from "vitest";
import { resolveWatchOpenInput } from "./watchOpen.ts";

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const LANE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;

describe("resolveWatchOpenInput", () => {
  it("passes ignoreIds through when ignoreSelf was not asked", () => {
    expect(
      resolveWatchOpenInput({ name: "campaign", ignoreIds: [LANE] }, {}).input
        .ignoreIds,
    ).toEqual([LANE]);
    expect(
      Object.hasOwn(
        resolveWatchOpenInput({ name: "campaign" }, {}).input,
        "ignoreIds",
      ),
    ).toBe(false);
  });

  it("unions ignoreSelf with listed mutes when the transport knows the caller", () => {
    const { input } = resolveWatchOpenInput(
      { name: "campaign", ignoreIds: [LANE], ignoreSelf: true },
      { KAVAL_TERMINAL_ID: SELF },
    );
    expect([...(input.ignoreIds ?? [])].sort()).toEqual([LANE, SELF].sort());
    expect(Object.hasOwn(input, "ignoreSelf")).toBe(false);
  });

  it("refuses ignoreSelf when the transport cannot identify the caller", () => {
    try {
      resolveWatchOpenInput({ name: "campaign", ignoreSelf: true }, {});
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).message).toMatch(/KAVAL_TERMINAL_ID/);
      expect((e as ToolFailure).detail).toEqual({
        kind: "ignore-self-unresolvable",
      });
    }
  });

  it("refuses when ignoreSelf mutes the only id the subscription is scoped to", () => {
    try {
      resolveWatchOpenInput(
        { name: "campaign", ids: [SELF], ignoreSelf: true },
        { KAVAL_TERMINAL_ID: SELF },
      );
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).message).toMatch(/can never match/);
      expect((e as ToolFailure).detail).toEqual({
        kind: "muted-covers-include",
      });
    }
  });

  it("refuses ids ∩ ignoreIds the same way, even without ignoreSelf", () => {
    try {
      resolveWatchOpenInput(
        { name: "campaign", ids: [SELF], ignoreIds: [SELF] },
        {},
      );
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).detail).toEqual({
        kind: "muted-covers-include",
      });
    }
  });

  it("refuses ignoreSelf rather than guessing when the stamp is not a terminal id", () => {
    try {
      resolveWatchOpenInput(
        { name: "campaign", ignoreSelf: true },
        { KAVAL_TERMINAL_ID: "not-a-uuid" },
      );
      expect.unreachable("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolFailure);
      expect((e as ToolFailure).detail).toEqual({
        kind: "ignore-self-invalid",
        raw: "not-a-uuid",
      });
    }
  });
});
