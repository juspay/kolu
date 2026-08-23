/**
 * `kolu wait`'s two judgements that need no socket, pinned: the `--until`
 * grammar, and the sentence an INTERRUPTED wait leaves behind.
 *
 * Both are the same kind of promise. `kolu wait` exists to be the condition a
 * driving loop branches on, so an outcome this verb reports wrongly is not a
 * cosmetic bug — it is a loop told "the work finished" when nothing finished,
 * or a Ctrl+C that says nothing about what it left running.
 *
 *   - {@link planUntil} decides which of the three condition forms was asked
 *     for, and refuses the two ways a `match:` pattern can be a FALSE done
 *     signal (empty, or empty-matching).
 *   - {@link withInterruptReport} is the interrupted arm of the exit contract,
 *     driven here through the real mechanism: `fiber.interruptUnsafe`, the same
 *     call `NodeRuntime.runMain`'s SIGINT handler makes, and
 *     `Runtime.defaultTeardown`, the same lookup that turns the resulting exit
 *     into the process's code.
 *
 * What is NOT drivable from here is the hop before that one — a real SIGINT
 * arriving at a real `kolu wait` process — which is `@effect/platform-node`'s
 * handler, not this package's code.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Cause, Effect, Exit, Runtime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitInterrupted } from "../exit.ts";
import { describeWait, planUntil, withInterruptReport } from "./wait.ts";

/** The parse's refusal message, or a loud failure naming what it accepted
 *  instead — a test that let an accepted spec slip through as `undefined` would
 *  assert nothing. */
const refusal = (raw: string): string => {
  const parsed = planUntil(raw);
  if (parsed.kind !== "error")
    throw new Error(
      `expected --until ${JSON.stringify(raw)} to be refused; it parsed as ${parsed.value.condition.kind}`,
    );
  return parsed.message;
};

/** The parsed plan, or a loud failure carrying the refusal. */
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
    // 0 never settles; above the setTimeout ceiling fires a FALSE near-instant
    // idle — both are the shared timer-range rule, not a parse nicety.
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
    // The forms a caller actually reaches for, all still legal.
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
    // Each of these is spelled correctly and means "match at index 0 of the
    // first delta" — a shell prompt, a banner, the agent echoing the brief.
    // `kolu wait --until 'match:a*'` would exit 0 the moment ANY byte arrived,
    // and the loop above it would read that 0 as "the work finished".
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
      // The refusal has to be actionable: it names what goes wrong (an exit 0
      // before the sentinel printed) and a spelling that does not.
      expect(message).toContain("exit 0 before your sentinel printed");
      expect(message).toContain("match:'.+'");
    }
  });

  it("keeps the ONE-BYTE-of-anything wait spellable, as an explicit ask", () => {
    // `.+` is the honest spelling of "any output at all" — it cannot fire on a
    // zero-length match, so a caller who means it says so.
    expect(planOf("match:.+").condition.kind).toBe("match");
  });
});

describe("the phrase a failure line names", () => {
  it("names the CONJUNCT too, so a `--settled` timeout says which half never came", () => {
    // Without this, `kolu wait … --until awaiting,waiting --settled 15000`
    // times out saying only "waiting for 4bba to reach awaiting/waiting" — and
    // sends its reader at the wrong half. The bucket may well have landed; it
    // is the QUIET that never came, because the agent's subagent is still
    // printing. That distinction is the entire reason the flag exists.
    expect(describeWait(planOf("awaiting,waiting"), 15000)).toBe(
      "awaiting/waiting with 15000ms of output quiet",
    );
    // Composes with the other two forms, which is why it is a modifier and not
    // a fourth `--until` prefix.
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

describe("an interrupted wait", () => {
  const id = "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d" as TerminalId;

  /** A wait that never settles on its own — the shape the real watchers have
   *  while a terminal is quiet: a promise nothing but teardown will resolve. */
  const neverSettles = Effect.tryPromise({
    try: () => new Promise<never>(() => {}),
    catch: (err) => err,
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Run `effect` to the first suspension, interrupt it exactly the way
   *  `NodeRuntime.runMain`'s SIGINT handler does, and hand back the exit plus
   *  everything the process wrote to stderr. */
  const interruptDuring = async <A, E>(
    effect: Effect.Effect<A, E>,
  ): Promise<{ exit: Exit.Exit<A, E>; stderr: string }> => {
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const fiber = Effect.runFork(effect);
    // Let the fiber reach its suspension before the interrupt lands, so this
    // pins the live-wait case rather than a fiber interrupted before it began.
    await new Promise((resolve) => setImmediate(resolve));
    const exit = await new Promise<Exit.Exit<A, E>>((resolve) => {
      fiber.addObserver(resolve);
      fiber.interruptUnsafe(fiber.id);
    });
    return { exit, stderr: written.join("") };
  };

  it("writes the exit contract's exact interrupted line, naming the terminal it left running", async () => {
    const { stderr } = await interruptDuring(
      withInterruptReport(id, neverSettles),
    );
    expect(stderr).toBe("kolu: interrupted; a1b2c3d4 left running\n");
    // ...and it is `exit.ts`'s sentence, not a second copy that happens to
    // agree today: the same constructor `reportOutcome` fails with.
    expect(stderr).toBe(waitInterrupted({ terminal: "a1b2c3d4" }).stderr);
  });

  it("exits 130 — the finalizer must not turn an interrupt into some other failure", async () => {
    const { exit } = await interruptDuring(
      withInterruptReport(id, neverSettles),
    );
    // The cause has to stay interrupts-ONLY: `defaultTeardown` reads 130 off
    // exactly that, and a failing finalizer would demote the run to 1.
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) throw new Error("unreachable");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    const codes: number[] = [];
    Runtime.defaultTeardown(exit, (code) => codes.push(code));
    expect(codes).toEqual([130]);
  });

  it("says NOTHING when the wait settles on its own", async () => {
    // The finalizer is the interrupted arm and only that arm: a met/timeout
    // wait's reporting is `reportOutcome`'s, and a stray line here would be a
    // second, contradictory answer on the same stream.
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
    const outcome = await Effect.runPromise(
      withInterruptReport(id, Effect.succeed({ kind: "met" as const })),
    );
    expect(outcome).toEqual({ kind: "met" });
    expect(written).toEqual([]);
  });
});
