import { Cause, Effect, Exit, Runtime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEBRIEF_PLAN, DEBRIEF_UNTIL } from "../debriefProtocol.ts";
import { waitInterrupted } from "../exit.ts";
import { describeWait, onInterruptReport, planUntil } from "./wait.ts";

const refusal = (raw: string): string => {
  const parsed = planUntil(raw);
  if (parsed.kind !== "error")
    throw new Error(
      `expected --until ${JSON.stringify(raw)} to be refused; it parsed as ${parsed.value.condition.kind}`,
    );
  return parsed.message;
};

const planOf = (raw: string) => {
  const parsed = planUntil(raw);
  if (parsed.kind !== "ok")
    throw new Error(
      `expected --until ${JSON.stringify(raw)} to parse; it was refused: ${parsed.message}`,
    );
  return parsed.value;
};

describe("--until, the three forms", () => {
  it("reads idle:<ms> as a window, and refuses anything that is not a count", () => {
    expect(planOf("idle:800")).toEqual({
      condition: { kind: "idle", idleMs: 800 },
      describe: "output idle for 800ms",
    });
    for (const bad of ["idle:", "idle:-5", "idle:8.5", "idle:8e2", "idle: 8"]) {
      expect(refusal(bad)).toContain("positive whole number of milliseconds");
    }
    expect(refusal("idle:0")).toContain("must be between 1 and");
    expect(refusal("idle:2147483648")).toContain("must be between 1 and");
  });

  it("reads a bucket list as any-of, and names all three forms when a token is none of them", () => {
    expect(planOf("awaiting,working")).toEqual({
      condition: { kind: "agent", targets: new Set(["awaiting", "working"]) },
      describe: "awaiting/working",
    });
    const nope = refusal("dnoe");
    expect(nope).toContain("idle:<ms>");
    expect(nope).toContain("match:<regex>");
    expect(nope).toContain("awaiting");
  });

  it("reads match:<regex> as the sentinel route", () => {
    const plan = planOf("match:DONE");
    expect(plan.condition.kind).toBe("match");
    if (plan.condition.kind !== "match") throw new Error("unreachable");
    expect(plan.condition.pattern.source).toBe("DONE");
    expect(plan.describe).toBe('output matching "DONE"');
    for (const ok of [
      "match:DONE",
      "match:^kolu-done$",
      "match:\\bREADY\\b",
      "match:.+",
      "match:[0-9]+ passed",
    ]) {
      expect(planOf(ok).condition.kind).toBe("match");
    }
  });

  it("refuses an invalid regex rather than waiting on a pattern nothing can match", () => {
    expect(refusal("match:[")).toContain("invalid regex");
  });
});

describe("--until match: the FALSE done-signal refusals", () => {
  it("refuses a bare match: with nothing after it", () => {
    expect(refusal("match:")).toContain("needs a non-empty pattern");
  });

  it("refuses every pattern that also matches the EMPTY STRING", () => {
    for (const footgun of [
      "match:a*",
      "match:x?",
      "match:^",
      "match:$",
      "match:()",
      "match:.*",
      "match:(?:)",
      "match:DONE|",
      "match:(DONE)?",
    ]) {
      const message = refusal(footgun);
      expect(message).toContain("matches the empty string");
      expect(message).toContain("exit 0 before your sentinel printed");
      expect(message).toContain("match:'.+'");
    }
  });

  it("keeps the ONE-BYTE-of-anything wait spellable, as an explicit ask", () => {
    expect(planOf("match:.+").condition.kind).toBe("match");
  });
});

describe("the phrase a failure line names", () => {
  it("names the CONJUNCT too, so a `--settled` timeout says which half never came", () => {
    expect(describeWait(planOf("awaiting,waiting"), 15000)).toBe(
      "awaiting/waiting with 15000ms of output quiet",
    );
    expect(describeWait(planOf("match:DONE"), 2000)).toBe(
      'output matching "DONE" with 2000ms of output quiet',
    );
  });

  it("is the condition alone when no conjunct was asked for", () => {
    expect(describeWait(planOf("idle:800"), undefined)).toBe(
      "output idle for 800ms",
    );
  });
});

describe("the debrief protocol", () => {
  it("spells the same condition `debrief` runs pre-parsed", () => {
    expect(planUntil(DEBRIEF_UNTIL)).toEqual({
      kind: "ok",
      value: DEBRIEF_PLAN,
    });
  });
});

describe("an interrupted wait", () => {
  const interruptedLine = waitInterrupted({ terminal: "a1b2c3d4" });

  const neverSettles = Effect.tryPromise({
    try: () => new Promise<never>(() => {}),
    catch: (err) => err,
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const interruptDuring = async <A, E>(
    effect: Effect.Effect<A, E>,
  ): Promise<{ exit: Exit.Exit<A, E>; stderr: string }> => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const fiber = Effect.runFork(effect);
    await new Promise((resolve) => setImmediate(resolve));
    const exit = await new Promise<Exit.Exit<A, E>>((resolve) => {
      fiber.addObserver(resolve);
      fiber.interruptUnsafe(fiber.id);
    });
    return { exit, stderr: written.join("") };
  };

  it("writes the exit contract's exact interrupted line, naming the terminal it left running", async () => {
    const { stderr } = await interruptDuring(
      onInterruptReport(interruptedLine, neverSettles),
    );
    expect(stderr).toBe("kolu: interrupted; a1b2c3d4 left running\n");
    expect(stderr).toBe(waitInterrupted({ terminal: "a1b2c3d4" }).stderr);
  });

  it("exits 130 — the finalizer must not turn an interrupt into some other failure", async () => {
    const { exit } = await interruptDuring(
      onInterruptReport(interruptedLine, neverSettles),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) throw new Error("unreachable");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    const codes: number[] = [];
    Runtime.defaultTeardown(exit, (code) => codes.push(code));
    expect(codes).toEqual([130]);
  });

  it("says NOTHING when the wait settles on its own", async () => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const outcome = await Effect.runPromise(
      onInterruptReport(
        interruptedLine,
        Effect.succeed({ kind: "met" as const }),
      ),
    );
    expect(outcome).toEqual({ kind: "met" });
    expect(written).toEqual([]);
  });
});
