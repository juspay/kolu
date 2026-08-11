/**
 * `kolu debrief` is DEFINITIONAL — pinned by asserting the argv it hands `wait`.
 *
 * The verb's whole claim to existence is that it can never drift from the
 * invocation it sugars (kolu#2139: a second face that could disagree with the
 * primitive is worse than a documented incantation). That claim is exactly one
 * fact — what `run` passes to `wait`'s `run` — so it is asserted directly rather
 * than inferred from a dial nobody can make in a unit test.
 *
 * The failure this catches is the quiet one: a future edit that drops
 * `--snapshot` still runs, still exits 0, and hands its caller no screen; one
 * that drops `--settled` still runs and re-opens the exact field incident (an
 * orchestrator nudging a worker whose subagent is still going). Neither shows up
 * anywhere but here.
 */

import { describe, expect, it, vi } from "vitest";
import {
  DEBRIEF_EXPANSION,
  DEBRIEF_QUIET_MS,
  DEBRIEF_TAIL_LINES,
  DEBRIEF_UNTIL,
} from "../debriefProtocol.ts";
import type { Endpoint } from "../endpoint.ts";
import type { WaitArgs } from "./wait.ts";

const waited: WaitArgs[] = [];

vi.mock("./wait.ts", () => ({
  run: (_endpoint: Endpoint, args: WaitArgs) => {
    waited.push(args);
    // The real `run` hands back an Effect; nothing here runs it.
    return { _pinned: true };
  },
}));

const { run } = await import("./debrief.ts");

const endpoint: Endpoint = { kind: "auto" };

/** The `WaitArgs` a `kolu debrief` invocation produces. */
const expansionOf = (
  over: Partial<{
    quiet: number;
    tail: number;
    timeout: number;
    json: boolean;
  }>,
): WaitArgs => {
  waited.length = 0;
  run(endpoint, {
    id: "3f9c",
    quiet: DEBRIEF_QUIET_MS,
    tail: DEBRIEF_TAIL_LINES,
    timeout: undefined,
    json: false,
    ...over,
  });
  const args = waited[0];
  if (args === undefined) throw new Error("debrief did not call wait at all");
  return args;
};

describe("kolu debrief — the expansion", () => {
  it("is `wait --until awaiting,waiting --settled <quiet> --snapshot <tail>`", () => {
    expect(expansionOf({})).toEqual({
      id: "3f9c",
      until: DEBRIEF_UNTIL,
      settled: DEBRIEF_QUIET_MS,
      snapshot: DEBRIEF_TAIL_LINES,
      timeout: undefined,
      json: false,
    });
  });

  it("waits for the turn to END — never for `working`, the bucket it waits to leave", () => {
    expect(DEBRIEF_UNTIL.split(",").sort()).toEqual(["awaiting", "waiting"]);
  });

  it("passes `--quiet` as `--settled` and `--tail` as `--snapshot`, not the reverse", () => {
    // Two numbers of the same type in adjacent slots: a swap typechecks, runs,
    // and turns a 40ms quiet window plus a 15000-line screen into "debrief".
    const args = expansionOf({ quiet: 1234, tail: 7 });
    expect(args.settled).toBe(1234);
    expect(args.snapshot).toBe(7);
  });

  it("forwards `--timeout` and `--json` untouched — the outcome contract is `wait`'s", () => {
    const args = expansionOf({ timeout: 900_000, json: true });
    expect(args.timeout).toBe(900_000);
    expect(args.json).toBe(true);
  });

  it("`--help` promises the invocation that actually runs", () => {
    // The two are separate code paths — `cli.ts` renders the sentence, this verb
    // performs the call — so they are joined here rather than by convention.
    const args = expansionOf({});
    const promised = DEBRIEF_EXPANSION;
    expect(promised).toContain(`--until ${args.until}`);
    expect(promised).toContain(`--settled ${args.settled}`);
    expect(promised).toContain(`--snapshot ${args.snapshot}`);
  });
});
