/**
 * "That terminal is asleep", as the AGENT receives it — the sentence and the
 * structured arm (kolu#2361).
 *
 * padi's gate now answers `TerminalNotActive` for a terminal that is in the
 * roster but dormant, and a declared error decoded off a surface hop is NOT a
 * `ToolFailure` — so without the mapping in `asleep.ts` it would reach the
 * agent as prose with no `structuredContent` at all. That is what this pins:
 * the kind, the tag, the id and the state a driver branches on, beside the
 * sentence the model reads.
 */

import { TerminalNotActive } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  refusingAsleep,
  type TerminalAsleepRefusal,
  terminalAsleepFailure,
} from "./asleep.ts";

const asleep = (id: string) =>
  new TerminalNotActive({ id, state: "sleeping" as const });

describe("the asleep refusal an agent reads", () => {
  it("says the terminal is asleep and names the fix", () => {
    const failure = terminalAsleepFailure(asleep("3f1c"));
    expect(failure?.message).toBe(
      "Terminal 3f1c is asleep — wake it before reading its screen, or skip it and say it is asleep",
    );
  });

  it("carries the tag, the id and the state as structured data", () => {
    const failure = terminalAsleepFailure(asleep("3f1c"));
    expect(failure?.detail).toEqual({
      kind: "terminal-not-active",
      tag: "TerminalNotActive",
      id: "3f1c",
      state: "sleeping",
    });
  });

  it("words a PARKED record as the restore placeholder it is", () => {
    const failure = terminalAsleepFailure(
      new TerminalNotActive({ id: "3f1c", state: "parked" }),
    );
    expect(failure?.message).toContain("is parked");
    expect((failure?.detail as TerminalAsleepRefusal).state).toBe("parked");
  });

  it("unwraps the `cause` the waits' `tryPromise` wraps a rejection in", () => {
    // The `wait_*` tools lift a Promise-shaped waiter, so the engine's refusal
    // arrives inside an `UnknownError`. Reading only the top of that chain is
    // how a typed refusal silently becomes prose.
    const wrapped = Object.assign(new Error("An error occurred"), {
      cause: asleep("3f1c"),
    });
    expect(terminalAsleepFailure(wrapped)?.detail).toMatchObject({
      kind: "terminal-not-active",
      id: "3f1c",
    });
  });

  it("leaves every other failure exactly as it was", () => {
    const other = new Error("the link dropped");
    expect(terminalAsleepFailure(other)).toBe(undefined);
    expect(
      Effect.runSync(Effect.flip(refusingAsleep(Effect.fail(other)))),
    ).toBe(other);
  });

  it("is a ToolFailure, which is what `failFrom` turns into structuredContent", () => {
    const refused = Effect.runSync(
      Effect.flip(refusingAsleep(Effect.fail(asleep("3f1c")))),
    );
    expect(refused).toBeInstanceOf(ToolFailure);
  });
});
