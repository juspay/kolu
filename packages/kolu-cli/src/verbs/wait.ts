/**
 * `kolu wait` — the done-signal. THE verb a driving agent's loop is built out
 * of, and the reason this CLI can subsume both TUIs: `padi-tui wait` blocked on
 * an AGENT's state, `kaval-tui wait` blocked on raw OUTPUT, and a driver that
 * wanted both had to run two binaries. One `--until` flag now carries all three
 * condition forms, over one padi link.
 *
 * ## Three forms, one flag — and why the parse decides which
 *
 *   `idle:<ms>`      no output byte for <ms>. Agent-agnostic: it works on a bare
 *                    shell, a `less`, an agent nobody wrote a state sensor for.
 *   `match:<regex>`  NEW output matched. The sentinel/marker route ("wait until
 *                    it prints DONE") — also agent-agnostic.
 *   `<buckets>`      the agent reached `working` / `awaiting` / `waiting` (a
 *                    comma list means any-of). The PRECISE route when padi's
 *                    agent sensor knows the tool: it distinguishes "the turn
 *                    ended" from "the model paused mid-thought", which no
 *                    quiescence window can.
 *
 * The forms are told apart by PREFIX, not by a mode flag, because a mode flag
 * would let a caller name a mode and a condition that disagree. `idle:`/`match:`
 * are reserved prefixes; anything else is read as the bucket list, and an
 * unrecognized bucket is a loud usage error naming all three forms — never a
 * silent fall-through to "wait for something".
 *
 * ## Every watcher is padi's — one outcome vocabulary
 *
 * All three forms ride padi's OWN primitives — `awaitOutputSettled` /
 * `awaitAgentState` / `awaitOutputMatch` in `@kolu/padi/dial` — the same ones
 * kolu's MCP face calls, so a driver gets the same answer whether it speaks argv
 * or MCP. `match:` was the last one to have a hand-rolled watcher in THIS
 * module, and that copy is exactly what a composition root must not own: it
 * consumed `terminalAttach` raw, outside the per-subscription retry fence (so a
 * transport blip killed the wait instead of re-subscribing —
 * `.claude/rules/streaming.md` rule 1), and it raced `terminalExit` in a way
 * that could report a terminal whose sentinel HAD printed as "gone". It lives in
 * `packages/padi/src/watch.ts` now, beside its two siblings, where that
 * subscription spine is written once.
 *
 * What stays here is what is genuinely CLI: the `--until` grammar (the three
 * prefixes, their rejections, and the phrase each condition is named by in a
 * failure line) — argv vocabulary padi has no business knowing.
 *
 * All three settle into ONE union — `@kolu/surface/wait`'s `WaitOutcome` — so
 * there is exactly one place mapping an outcome to the exit contract
 * ({@link reportOutcome}), and a fourth condition form would inherit it for
 * free. That is also what keeps the codes honest: met → 0, timeout → 2, the
 * terminal exited first → 3, a dropped link → 1.
 *
 * ## `--json` is one frame shape for every outcome
 *
 * Every arm — met, timeout, gone, interrupted, closed — emits the shared
 * `waitOutcomeJson` frame (`{ id, result, … }`) on stdout, so a `--json` driver
 * branches on `result` and never on the exit code. This is `kaval-tui wait
 * --json`'s frame, adopted for all three families; `padi-tui wait --json`
 * printed `{ id, agent }` on `met` and NOTHING on a timeout, which left its
 * only structured consumer doing exit-code archaeology. The agent arm's met
 * payload still carries the full `agent` record, so nothing is lost by the
 * move.
 *
 * ## Ctrl+C
 *
 * The run edge (`NodeRuntime.runMain`) owns SIGINT and turns it into fiber
 * interruption, which Effect's own teardown reports as 130 — exactly this
 * contract's interrupted code. So this verb installs NO competing signal
 * handler; it threads an abort that fires on scope close into the promise-shaped
 * watchers, so an interrupted wait tears its subscriptions down instead of
 * abandoning them, and maps the union's `interrupted` arm to {@link
 * WaitInterrupted} so the code is stated in one place either way.
 */

import {
  type AgentStateOutcome,
  awaitAgentState,
  awaitOutputMatch,
  awaitOutputSettled,
  type PadiSurfaceClient,
  WAIT_STATES,
} from "@kolu/padi/dial";
import { formatWaitMet, parseUntilStates, shortId } from "@kolu/padi/render";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  type WaitOutcome,
  waitOutcomeJson,
} from "@kolu/surface/wait";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Option, type Scope } from "effect";
import { type Endpoint, withPadi } from "../endpoint.ts";
import {
  type CliFailure,
  failure,
  WaitInterrupted,
  WaitTerminalGone,
  WaitTimedOut,
} from "../exit.ts";
import { resolveTerminal, writeErr, writeOut } from "./shared.ts";

/** The flags Effect CLI parses for `kolu wait` (see `cli.ts`). */
export interface WaitArgs {
  readonly id: string;
  readonly until: string;
  readonly timeout: Option.Option<number>;
  readonly json: boolean;
}

// ── Output ───────────────────────────────────────────────────────────────────
//
// Both channels are `./shared.ts`'s. Waiting for the write to DRAIN matters on
// the failing arms: a `--json` timeout prints its frame and THEN fails, and the
// run edge answers a failure with `process.exit`, which truncates a
// still-buffered pipe write — draining is what keeps `kolu wait … --json | jq`
// from losing the frame it is about to branch on. A closed stdout
// (`… | head -1`) is a complete wait: the outcome is still carried by the exit
// code, and a hung-up reader is not this verb's failure to report.

// ── `--until`, parsed ────────────────────────────────────────────────────────

/** The three forms, spelled once — the body of every "that is not a condition"
 *  error, so a user who mistypes one form learns the other two exist. */
const UNTIL_FORMS = `  idle:<ms>      no output byte for <ms> — works on ANY terminal, agent or not
  match:<regex>  NEW output matched <regex>
  <buckets>      the agent reached one of: ${WAIT_STATES.join(", ")} (comma-separated means any-of)`;

/** What a parsed `--until` asks this verb to block on. `describe` is the human
 *  phrase the timeout/gone lines name ("timed out … waiting for X to reach
 *  <describe>"), carried on the plan so the failure text can never drift from
 *  the condition that produced it. */
type WaitPlan =
  | {
      readonly kind: "idle";
      readonly idleMs: number;
      readonly describe: string;
    }
  | {
      readonly kind: "match";
      readonly regex: RegExp;
      readonly describe: string;
    }
  | {
      readonly kind: "agent";
      readonly targets: ReadonlySet<string>;
      readonly describe: string;
    };

/** Parse `--until` into a {@link WaitPlan}, or a loud, actionable message.
 *
 *  Pure, and run BEFORE the dial: a bad spec must not provision a `--host`
 *  daemon we would immediately drop. The `idle:`/`match:` arms are ported from
 *  kaval-tui's `parseUntil` (digits-only, timer-range guard, non-empty valid
 *  regex — each rejection naming the form it belongs to rather than the generic
 *  three); the bucket arm delegates to `parseUntilStates`, whose rejection is
 *  re-spelled with all three forms because a token that is not a bucket may
 *  simply be a mistyped prefix. */
function planUntil(
  raw: string,
):
  | { readonly kind: "ok"; readonly plan: WaitPlan }
  | { readonly kind: "error"; readonly message: string } {
  if (raw.startsWith("idle:")) {
    const spelled = raw.slice("idle:".length);
    // Digits only: a count of milliseconds is a whole number, so reject "",
    // "-5", "8.5", "8e2", " 8" at the boundary rather than coercing via Number().
    if (!/^\d+$/.test(spelled)) {
      return {
        kind: "error",
        message: `--until idle:<ms> needs a positive whole number of milliseconds, got ${JSON.stringify(spelled)} (e.g. idle:800).`,
      };
    }
    const idleMs = Number(spelled);
    // 0 never settles, and a window above the setTimeout ceiling overflows and
    // fires near-instantly (a FALSE "idle") — both fail the shared timer-range
    // rule, so crash loud rather than coerce.
    if (!isValidTimerMs(idleMs)) {
      return {
        kind: "error",
        message: `--until idle:<ms> must be between 1 and ${MAX_TIMER_MS} (~24.8 days): 0 never settles and a larger window overflows the timer, got ${JSON.stringify(spelled)}.`,
      };
    }
    return {
      kind: "ok",
      plan: { kind: "idle", idleMs, describe: `output idle for ${idleMs}ms` },
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
    try {
      return {
        kind: "ok",
        plan: {
          kind: "match",
          regex: new RegExp(pattern),
          describe: `output matching ${JSON.stringify(pattern)}`,
        },
      };
    } catch (err) {
      return {
        kind: "error",
        message: `--until match: invalid regex ${JSON.stringify(pattern)} — ${(err as Error).message}`,
      };
    }
  }

  const states = parseUntilStates(raw);
  if (states.kind === "error") {
    return {
      kind: "error",
      message: `--until ${JSON.stringify(raw)} is none of the three condition forms:\n${UNTIL_FORMS}`,
    };
  }
  return {
    kind: "ok",
    plan: {
      kind: "agent",
      targets: states.targets,
      describe: [...states.targets].join("/"),
    },
  };
}

// ── The outcome, and the one place it becomes an exit code ───────────────────

/** What each condition form stamps on a `met`. `fired` discriminates the three,
 *  so the JSON projection and the trailer both follow one tag rather than
 *  guessing from which field is present. */
type WaitMetPayload =
  | { readonly fired: "idle"; readonly elapsedMs: number }
  | {
      readonly fired: "match";
      readonly elapsedMs: number;
      readonly matchedLine: string;
    }
  | {
      readonly fired: "agent";
      readonly elapsedMs: number;
      readonly agent: AgentInfo;
    };

/** The one outcome union all three forms settle into. */
type KoluWaitOutcome = WaitOutcome<WaitMetPayload>;

/** Re-tag an agent wait's met payload so it joins {@link WaitMetPayload}. The
 *  four terminal arms are already the shared shape and pass through untouched. */
function withAgentTag(outcome: AgentStateOutcome): KoluWaitOutcome {
  return outcome.kind === "met"
    ? {
        fired: "agent",
        kind: "met",
        elapsedMs: outcome.elapsedMs,
        agent: outcome.agent,
      }
    : outcome;
}

/** The human trailer for a met — stderr, because the wait's payload is the exit
 *  code and (under `--json`) the frame, never this line. The agent arm defers to
 *  `formatWaitMet` so the bucket-and-state wording matches `kolu ls`. */
function metTrailer(id: TerminalId, met: WaitMetPayload): string {
  switch (met.fired) {
    case "idle":
      return `— ${shortId(id)} output idle after ${met.elapsedMs}ms\n`;
    case "match":
      return `— ${shortId(id)} matched ${JSON.stringify(met.matchedLine)} after ${met.elapsedMs}ms\n`;
    case "agent":
      return `— ${formatWaitMet(id, met.agent)}\n`;
  }
}

/**
 * Turn a settled outcome into output plus the exit contract — the ONE mapping,
 * shared by all three condition forms.
 *
 * `--json` emits a frame for EVERY arm (before the failing ones raise), so a
 * structured driver reads `result` rather than inferring from the code. The
 * failures carry their own exact stderr line and their own code marker (see
 * `exit.ts`), so nothing here calls `process.exit` — the run edge owns that.
 */
function reportOutcome(
  id: TerminalId,
  outcome: KoluWaitOutcome,
  describe: string,
  json: boolean,
): Effect.Effect<
  void,
  CliFailure | WaitTimedOut | WaitTerminalGone | WaitInterrupted
> {
  return Effect.gen(function* () {
    if (json) {
      yield* writeOut(
        `${JSON.stringify(
          waitOutcomeJson<WaitMetPayload>(id, outcome, (met) =>
            met.fired === "match"
              ? {
                  fired: "match",
                  elapsedMs: met.elapsedMs,
                  matchedLine: met.matchedLine,
                }
              : met.fired === "agent"
                ? {
                    fired: "agent",
                    elapsedMs: met.elapsedMs,
                    agent: met.agent,
                  }
                : { fired: "idle", elapsedMs: met.elapsedMs },
          ),
          null,
          2,
        )}\n`,
        "the wait outcome",
      );
    }

    switch (outcome.kind) {
      case "met":
        if (!json) yield* writeErr(metTrailer(id, outcome));
        return;
      case "timeout":
        // Report the outcome's OWN elapsed (always populated) rather than the
        // `--timeout` flag, which is optional — a future non-timer timeout route
        // could otherwise print "undefinedms".
        return yield* Effect.fail(
          new WaitTimedOut({
            stderr: `kolu: timed out after ${outcome.elapsedMs}ms waiting for ${shortId(id)} to reach ${describe}.\n`,
          }),
        );
      case "gone":
        return yield* Effect.fail(
          new WaitTerminalGone({
            stderr: `kolu: ${shortId(id)} exited before reaching ${describe} — its terminal is gone.\n`,
          }),
        );
      case "interrupted":
        return yield* Effect.fail(
          new WaitInterrupted({
            stderr: `— interrupted; ${shortId(id)} left running\n`,
          }),
        );
      case "closed":
        // The link dropped before the condition landed — a failure, never a
        // clean stop that would look like a met wait.
        return yield* Effect.fail(
          failure(
            outcome.error ??
              "the padi link closed — the daemon stopped or the connection dropped. Is kolu still running?",
          ),
        );
    }
  });
}

// ── The verb ─────────────────────────────────────────────────────────────────

// The id-or-prefix widening is `./shared.ts`'s `resolveTerminal`. Worth knowing
// here: an empty `$id` resolves to NOTHING (see `resolveTerminalId`), so a
// driver whose variable went empty is told so instead of waiting on whichever
// terminal happened to be the only one.

/** An abort that fires when the caller's scope closes — the handle the
 *  promise-shaped watchers need to unwind their subscriptions.
 *
 *  Every padi watcher takes an `AbortSignal` and documents that it must be
 *  threaded into every subscription it opens; a fiber interruption (the run
 *  edge's Ctrl+C) abandons the `Effect.tryPromise` around them, which would
 *  otherwise leave the attach/mirror subscriptions running while the link is
 *  being disposed underneath. Binding the abort to the scope makes the teardown
 *  structural: every exit path — met, timeout, failure, interruption — closes
 *  the scope, and closing it is the abort. */
const abortOnScopeClose: Effect.Effect<AbortSignal, never, Scope.Scope> =
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    ),
    (controller) => controller.signal,
  );

/** Run the plan's watcher and hand back the one outcome union — the ONE place
 *  the three condition forms differ, so `run` below reads as dial → resolve →
 *  wait → report regardless of which form was asked for.
 *
 *  All three watchers are padi's, and all three are Promise-shaped, so each
 *  takes the scope-bound `signal` that unwinds its subscriptions. `--timeout` is
 *  passed as an ABSENT key when unset (an explicit `undefined` would read as "no
 *  timeout" only by accident of the option's own optionality). */
function awaitPlan(
  client: PadiSurfaceClient,
  id: TerminalId,
  plan: WaitPlan,
  opts: {
    readonly timeoutMs: number | undefined;
    readonly signal: AbortSignal;
  },
): Effect.Effect<KoluWaitOutcome, unknown> {
  const { timeoutMs, signal } = opts;
  const timeout = timeoutMs !== undefined ? { timeoutMs } : {};
  switch (plan.kind) {
    case "match":
      return Effect.tryPromise({
        try: () =>
          awaitOutputMatch(client, {
            id,
            pattern: plan.regex,
            signal,
            ...timeout,
          }),
        catch: (err) => err,
      });
    case "idle":
      return Effect.tryPromise({
        try: () =>
          awaitOutputSettled(client, {
            id,
            idleMs: plan.idleMs,
            signal,
            ...timeout,
          }),
        catch: (err) => err,
      });
    case "agent":
      return Effect.map(
        Effect.tryPromise({
          try: () =>
            awaitAgentState(client, {
              id,
              targets: plan.targets,
              signal,
              ...timeout,
            }),
          catch: (err) => err,
        }),
        withAgentTag,
      );
  }
}

/**
 * `kolu wait <id> --until <condition> [--timeout ms] [--json]`.
 *
 * Order matters: the `--until` and `--timeout` parses are PURE and run before
 * the dial, so a malformed condition fails instantly rather than after
 * provisioning a cold `--host`. Then one link is dialed, the id prefix resolved
 * against it, and the condition's own watcher run under it; the link is released
 * the moment the wait settles, because the outcome is a value and nothing after
 * it needs the daemon.
 */
export function run(
  endpoint: Endpoint,
  args: WaitArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const parsed = planUntil(args.until);
    if (parsed.kind === "error")
      return yield* Effect.fail(failure(parsed.message));
    const plan = parsed.plan;

    const timeoutMs = Option.getOrUndefined(args.timeout);
    // The shared timer-range rule, enforced here because `runWait` THROWS a
    // RangeError on an out-of-range timeout — a usage error the user should see
    // as one line, not as a defect dump.
    if (timeoutMs !== undefined && !isValidTimerMs(timeoutMs)) {
      return yield* Effect.fail(
        failure(
          `--timeout must be between 1 and ${MAX_TIMER_MS} milliseconds (~24.8 days) — a larger delay overflows the timer and fires a false timeout almost immediately, got ${timeoutMs}.`,
        ),
      );
    }

    const { id, outcome } = yield* withPadi(endpoint, (conn) =>
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* abortOnScopeClose;
          const id = yield* resolveTerminal(conn, args.id);
          const outcome = yield* awaitPlan(conn.client, id, plan, {
            timeoutMs,
            signal,
          });
          return { id, outcome };
        }),
      ),
    );

    return yield* reportOutcome(id, outcome, plan.describe, args.json);
  });
}
