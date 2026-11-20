import { describe, expect, it, vi } from "vitest";
import {
  DEBRIEF_EXPANSION,
  DEBRIEF_PLAN,
  DEBRIEF_QUIET_MS,
  DEBRIEF_TAIL_LINES,
  DEBRIEF_UNTIL,
} from "../debriefProtocol.ts";
import type { Endpoint } from "../endpoint.ts";
import type { WaitArgs, WaitPlan } from "./wait.ts";

type WaitKnobs = Omit<WaitArgs, "until">;

const waited: Array<{
  plan: WaitPlan;
  args: WaitKnobs;
  invokedAs: string;
}> = [];

vi.mock("./wait.ts", () => ({
  runPlan: (
    _endpoint: Endpoint,
    plan: WaitPlan,
    args: WaitKnobs,
    invokedAs: string,
  ) => {
    waited.push({ plan, args, invokedAs });
    return { _pinned: true };
  },
}));

const { run } = await import("./debrief.ts");

const endpoint: Endpoint = { kind: "auto" };

const expansionOf = (
  over: Partial<{
    quiet: number;
    tail: number;
    timeout: number;
    json: boolean;
  }>,
): { plan: WaitPlan; args: WaitKnobs; invokedAs: string } => {
  waited.length = 0;
  run(endpoint, {
    id: "3f9c",
    quiet: DEBRIEF_QUIET_MS,
    tail: DEBRIEF_TAIL_LINES,
    timeout: undefined,
    json: false,
    ...over,
  });
  const call = waited[0];
  if (call === undefined) throw new Error("debrief did not call wait at all");
  return call;
};

describe("kolu debrief — the expansion", () => {
  it("is `wait --until awaiting,waiting --settled <quiet> --snapshot <tail>`", () => {
    const call = expansionOf({});
    expect(call.plan).toBe(DEBRIEF_PLAN);
    expect(call.args).toEqual({
      id: "3f9c",
      settled: DEBRIEF_QUIET_MS,
      snapshot: DEBRIEF_TAIL_LINES,
      timeout: undefined,
      json: false,
    });
  });

  it("waits for the turn to END — never for `working`, the bucket it waits to leave", () => {
    expect(DEBRIEF_UNTIL.split(",").sort()).toEqual(["awaiting", "waiting"]);
    const condition = DEBRIEF_PLAN.condition;
    if (condition.kind !== "agent")
      throw new Error(`debrief waits on ${condition.kind}, not on buckets`);
    expect([...condition.targets].sort()).toEqual(["awaiting", "waiting"]);
  });

  it("passes `--quiet` as `--settled` and `--tail` as `--snapshot`, not the reverse", () => {
    const { args } = expansionOf({ quiet: 1234, tail: 7 });
    expect(args.settled).toBe(1234);
    expect(args.snapshot).toBe(7);
  });

  it("forwards `--timeout` and `--json` untouched — the outcome contract is `wait`'s", () => {
    const { args } = expansionOf({ timeout: 900_000, json: true });
    expect(args.timeout).toBe(900_000);
    expect(args.json).toBe(true);
  });

  it("tells `wait` which verb the USER typed", () => {
    expect(expansionOf({}).invokedAs).toBe("kolu debrief");
  });

  it("`--help` promises the invocation that actually runs", () => {
    const { args } = expansionOf({});
    expect(DEBRIEF_EXPANSION).toContain(`--until ${DEBRIEF_UNTIL}`);
    expect(DEBRIEF_EXPANSION).toContain(`--settled ${args.settled}`);
    expect(DEBRIEF_EXPANSION).toContain(`--snapshot ${args.snapshot}`);
  });
});
