import { formatWaitMet, shortId } from "@kolu/padi/render";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { PADI_LINK_CLOSED, WAIT_STATES } from "@kolu/padi-client/terminalVocab";
import { terminalNotActiveOf } from "@kolu/padi-client/surface";
import {
  awaitTerminalCondition,
  type ConditionMet,
  type TerminalCondition,
  type TerminalConditionOutcome,
} from "@kolu/padi-client/watch";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  waitOutcomeJson,
} from "@kolu/surface/wait";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, type Scope } from "effect";
import type { Command } from "effect/cli";
import type { waitFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import {
  type CliFailure,
  errorMessage,
  failure,
  terminalAsleep,
  waitInterrupted,
  waitTerminalGone,
  waitTimedOut,
} from "../exit.ts";
import {
  type Parsed,
  resolveTerminal,
  waitStateTokens,
  writeErr,
  writeJson,
  writeOutBlock,
} from "./shared.ts";

export type WaitArgs = Command.Command.Config.Infer<typeof waitFlags>;

const UNTIL_FORMS = `  idle:<ms>      no output byte for <ms> — works on ANY terminal, agent or not
  match:<regex>  NEW output matched <regex>
  <buckets>      the agent reached one of: ${WAIT_STATES.join(", ")} (comma-separated means any-of)`;

const isFalseDoneSignal = (regex: RegExp): boolean => regex.test("");

export type WaitPlan = {
  readonly condition: TerminalCondition;
  readonly describe: string;
};

export function planUntil(raw: string): Parsed<WaitPlan> {
  if (raw.startsWith("idle:")) {
    const spelled = raw.slice("idle:".length);
    if (!/^\d+$/.test(spelled)) {
      return {
        kind: "error",
        message: `--until idle:<ms> needs a positive whole number of milliseconds, got ${JSON.stringify(spelled)} (e.g. idle:800).`,
      };
    }
    const idleMs = Number(spelled);
    if (!isValidTimerMs(idleMs)) {
      return {
        kind: "error",
        message: `--until idle:<ms> must be between 1 and ${MAX_TIMER_MS} (~24.8 days): 0 never settles and a larger window overflows the timer, got ${JSON.stringify(spelled)}.`,
      };
    }
    return {
      kind: "ok",
      value: {
        condition: { kind: "idle", idleMs },
        describe: `output idle for ${idleMs}ms`,
      },
    };
  }

  if (raw.startsWith("match:")) {
    const pattern = raw.slice("match:".length);
    if (pattern === "") {
      return {
        kind: "error",
        message:
          "--until match:<regex> needs a non-empty pattern (e.g. match:'DONE').",
      };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      return {
        kind: "error",
        message: `--until match: invalid regex ${JSON.stringify(pattern)} — ${errorMessage(err)}`,
      };
    }
    if (isFalseDoneSignal(regex)) {
      return {
        kind: "error",
        message: `--until match: ${JSON.stringify(pattern)} matches the empty string, so the FIRST byte of any output — a prompt, a banner — would satisfy it and this wait would exit 0 before your sentinel printed. Make every part required (e.g. match:'DONE' for the marker you print, or match:'.+' if you really mean "any output at all").`,
      };
    }
    return {
      kind: "ok",
      value: {
        condition: { kind: "match", pattern: regex },
        describe: `output matching ${JSON.stringify(pattern)}`,
      },
    };
  }

  const tokens = waitStateTokens(raw);
  if (tokens.kind === "error") {
    return {
      kind: "error",
      message: `--until ${JSON.stringify(raw)} is none of the three condition forms:\n${UNTIL_FORMS}`,
    };
  }
  const targets = new Set<string>(tokens.value);
  return {
    kind: "ok",
    value: {
      condition: { kind: "agent", targets },
      describe: [...targets].join("/"),
    },
  };
}

function metTrailer(id: TerminalId, met: ConditionMet): string {
  switch (met.fired) {
    case "idle":
      return `— ${shortId(id)} output idle after ${met.elapsedMs}ms\n`;
    case "match":
      return `— ${shortId(id)} matched ${JSON.stringify(met.matchedLine)} after ${met.elapsedMs}ms\n`;
    case "agent":
      return `— ${formatWaitMet(id, met.agent)}\n`;
  }
}

function failureFor(
  id: TerminalId,
  outcome: Exclude<TerminalConditionOutcome, { readonly kind: "met" }>,
  describe: string,
): CliFailure {
  switch (outcome.kind) {
    case "timeout":
      return waitTimedOut({
        terminal: shortId(id),
        elapsedMs: outcome.elapsedMs,
        describe,
      });
    case "gone":
      return waitTerminalGone({ terminal: shortId(id), describe });
    case "interrupted":
      return waitInterrupted({ terminal: shortId(id) });
    case "closed":
      return failure(outcome.error ?? PADI_LINK_CLOSED);
  }
}

function reportOutcome(
  id: TerminalId,
  outcome: TerminalConditionOutcome,
  describe: string,
  json: boolean,
): Effect.Effect<void, CliFailure> {
  return Effect.gen(function* () {
    if (json) {
      yield* writeJson(
        waitOutcomeJson<ConditionMet>(id, outcome, (m) => m),
        "the wait outcome",
      );
    }

    if (outcome.kind !== "met") {
      return yield* Effect.fail(failureFor(id, outcome, describe));
    }
    if (!json) {
      if (outcome.screen !== undefined) {
        yield* writeOutBlock(outcome.screen, "the screen text");
      }
      yield* writeErr(metTrailer(id, outcome));
    }
  });
}

const abortOnScopeClose: Effect.Effect<AbortSignal, never, Scope.Scope> =
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    ),
    (controller) => controller.signal,
  );

/** Report an INTERRUPTED wait — the 130 arm of the exit contract, on the only
 *  path that can still speak once the fiber has been interrupted.
 *
 *  Ctrl+C (or a SIGTERM from the driver above) reaches this process as fiber
 *  interruption, and Effect 4 makes that cause unrecoverable: the latched
 *  `_interruptedCause` replaces every continuation popped after it, so a
 *  `catchCause` here never runs and an `Effect.fail(waitInterrupted(…))` would
 *  be swallowed long before `main.ts` could print it. A finalizer still runs —
 *  so the arm's line is written from one, while the terminal id is in scope and
 *  the fact the user can act on ("<id> left running") is still known.
 *
 *  Two properties this shape is chosen for:
 *   - the sentence is `exit.ts`'s, byte for byte the one {@link reportOutcome}
 *     fails with, so the two routes to the interrupted arm cannot drift;
 *   - `writeErr` CANNOT fail, so the finalizer cannot add a failure to an
 *     interrupts-only cause — which is what keeps the run edge's teardown
 *     reading 130 rather than 1.
 *
 *  Exported for `wait.test.ts`, which drives the real mechanism: the same
 *  `fiber.interruptUnsafe` call `NodeRuntime.runMain`'s SIGINT handler makes. */
export function onInterruptReport<A, E, R>(
  report: CliFailure,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.onInterrupt(work, () => writeErr(report.stderr));
}

export function describeWait(
  plan: WaitPlan,
  settledMs: number | undefined,
): string {
  return settledMs === undefined
    ? plan.describe
    : `${plan.describe} with ${settledMs}ms of output quiet`;
}

function awaitPlan(
  client: PadiSurfaceClient,
  id: TerminalId,
  plan: WaitPlan,
  opts: {
    readonly timeoutMs: number | undefined;
    readonly settledMs: number | undefined;
    readonly screenTail: number | undefined;
    readonly signal: AbortSignal;
    readonly invokedAs: string;
  },
): Effect.Effect<TerminalConditionOutcome, unknown> {
  const { timeoutMs, settledMs, screenTail, signal } = opts;
  return Effect.tryPromise({
    try: () =>
      awaitTerminalCondition(client, {
        id,
        condition: plan.condition,
        signal,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(settledMs !== undefined ? { settledMs } : {}),
        ...(screenTail !== undefined ? { screenTail } : {}),
        retryAdvice: `re-run ${opts.invokedAs}`,
      }),
    catch: (err) => {
      const dormant = terminalNotActiveOf(err);
      return dormant === undefined
        ? err
        : terminalAsleep({
            terminal: shortId(id),
            state: dormant.state,
            attempted: "wait for it",
          });
    },
  });
}

export function runPlan(
  endpoint: Endpoint,
  plan: WaitPlan,
  args: Omit<WaitArgs, "until">,
  invokedAs: string,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const timeoutMs = args.timeout;
    const settledMs = args.settled;
    const screenTail = args.snapshot;

    const { id, outcome } = yield* withPadi(endpoint, (conn) =>
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* abortOnScopeClose;
          const id = yield* resolveTerminal(conn, args.id);
          const outcome = yield* onInterruptReport(
            waitInterrupted({ terminal: shortId(id) }),
            awaitPlan(conn.client, id, plan, {
              timeoutMs,
              settledMs,
              screenTail,
              signal,
              invokedAs,
            }),
          );
          return { id, outcome };
        }),
      ),
    );

    return yield* reportOutcome(
      id,
      outcome,
      describeWait(plan, settledMs),
      args.json,
    );
  });
}

export function run(
  endpoint: Endpoint,
  args: WaitArgs,
  invokedAs = "kolu wait",
): Effect.Effect<void, unknown> {
  const parsed = planUntil(args.until);
  return parsed.kind === "error"
    ? Effect.fail(failure(parsed.message))
    : runPlan(endpoint, parsed.value, args, invokedAs);
}
