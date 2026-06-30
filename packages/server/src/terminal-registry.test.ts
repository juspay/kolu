/**
 * Registry seam: the loud vs. quiet faces of a "no live terminal for this id" miss.
 *
 * `requireActiveTerminal` THROWS (handlers whose contract needs a live PTY — attach,
 * screen reads, paste/upload, kill). `activeTerminalForStreamOp` does NOT — for the
 * fire-and-forget stream ops (`sendInput` / `resize`) a message arriving just after a
 * kill removed the terminal is an EXPECTED race, not a fault, and must drop quietly
 * instead of raising the `terminalNotFound` that the oRPC logger prints at ERROR
 * (juspay/kolu#1628 — a focus-in `\e[I` report fired ~240ms after the kill).
 */

import { ORPCError } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log.ts";
import {
  type ActiveTerminalProcess,
  activeTerminalForStreamOp,
  registerTerminal,
  requireActiveTerminal,
  unregisterTerminal,
} from "./terminal-registry.ts";

const LIVE = "11111111-1111-4111-8111-111111111111";
const ABSENT = "22222222-2222-4222-8222-222222222222";

/** Only `handle` PRESENCE matters to the accessors under test (it narrows the union
 *  to the active arm); the rest of the record is irrelevant here — the sleep/wake
 *  suites cover meta/snapshot. */
function liveEntry(): ActiveTerminalProcess {
  return {
    handle: {} as ActiveTerminalProcess["handle"],
  } as ActiveTerminalProcess;
}

afterEach(() => {
  unregisterTerminal(LIVE);
  vi.restoreAllMocks();
});

describe("activeTerminalForStreamOp — the quiet twin of requireActiveTerminal (#1628)", () => {
  it("returns the live entry while the terminal is still active", () => {
    const entry = liveEntry();
    registerTerminal(LIVE, entry);
    expect(activeTerminalForStreamOp(LIVE, "sendInput")).toBe(entry);
  });

  it("drops a stream op for a closed terminal — undefined, never a throw", () => {
    const debug = vi.spyOn(log, "debug");
    // The exact #1628 race: a sendInput/resize lands after the kill unregistered the id.
    expect(() => activeTerminalForStreamOp(ABSENT, "sendInput")).not.toThrow();
    expect(activeTerminalForStreamOp(ABSENT, "resize")).toBeUndefined();
    // The drop stays observable at debug — it is never dressed up as an ERROR.
    expect(debug).toHaveBeenCalled();
  });

  it("leaves the LOUD seam intact: requireActiveTerminal still throws for an absent id", () => {
    // attach / screen reads / paste / kill keep raising the typed NOT_FOUND so a
    // genuinely-absent terminal stays loud there — the fix narrows only the two
    // stream ops, it does not blanket-silence every miss.
    expect(() => requireActiveTerminal(ABSENT)).toThrow(ORPCError);
  });
});
