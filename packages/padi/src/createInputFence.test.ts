/**
 * W12 — the create-input TYPE fence. The three server-derived authored facts
 * (`lastActivityAt`, `lastAgentCommand`, `restoreTarget`) must be unspellable by an
 * ordinary create and reachable only through `restoreSpawn`'s distinct `restoreOnly`
 * arm — the fence is the TYPE, not a convention. Before this split the exclusion was a
 * maintained `.omit(...)` on a shared shape; a future field could leak to the wire by
 * someone forgetting to extend the omit list. These pins fail loudly if that regresses.
 */

import {
  PadiCreateInputSchema,
  TOPLEVEL_PLACEMENT,
} from "@kolu/padi-client/surface";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createTerminal, restoreSpawn } from "./terminals.ts";

describe("create-input fence — restore-only facts never ride an ordinary create", () => {
  it("the wire schema carries none of the three restore-only facts (by construction, not omission)", () => {
    // `PadiCreateInputSchema` derives from the BASE `CreateTerminalInputSchema`, which
    // has no restore-only keys — so the decode strips them rather than an omit list
    // having to subtract them. A client that spells them gets them dropped at the
    // wire boundary.
    const parsed = Schema.decodeUnknownSync(PadiCreateInputSchema)({
      placement: { kind: "toplevel" },
      cwd: "/x",
      themeName: "dracula",
      lastActivityAt: 5,
      lastAgentCommand: "claude",
      restoreTarget: { kind: "none" },
    });
    expect("lastActivityAt" in parsed).toBe(false);
    expect("lastAgentCommand" in parsed).toBe(false);
    expect("restoreTarget" in parsed).toBe(false);
    // The base chrome + cwd still round-trip.
    expect(parsed.cwd).toBe("/x");
    expect(parsed.themeName).toBe("dracula");
  });

  it("compile-time: createTerminal forbids a restore-only field; restoreSpawn accepts it", () => {
    // tsc typechecks this arrow's body whether or not it runs; it is never invoked
    // (calling either constructor would spawn a real PTY), so it has no runtime effect.
    // The `@ts-expect-error` is the pin: if `CreateTerminalInput` ever regained a
    // restore-only field, the excess-property error would vanish and tsc would fail on
    // an UNUSED `@ts-expect-error` — the fence can't silently rot.
    const _fence = (): void => {
      createTerminal(TOPLEVEL_PLACEMENT, undefined, {
        // @ts-expect-error — CreateTerminalInput has no `restoreTarget`; an ordinary create can't forge a resume target.
        restoreTarget: { kind: "none" },
      });
      // restoreSpawn takes the restore-only facts through its distinct `restoreOnly` arm — no error.
      restoreSpawn(
        undefined,
        undefined,
        {},
        { restoreTarget: { kind: "none" } },
      );
    };
    void _fence; // reference (never call) so it isn't flagged unused
    expect(typeof _fence).toBe("function");
  });
});
