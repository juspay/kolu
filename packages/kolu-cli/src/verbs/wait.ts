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
 * ## Two modifiers, and why they are NOT a fourth form
 *
 *   `--settled <ms>`  a CONJUNCT on the condition: met means the condition holds
 *                     AND no output byte has arrived for <ms>.
 *   `--snapshot <N>`  an ENRICHMENT of the payload: the met carries the last <N>
 *                     rendered screen lines.
 *
 * They exist because the loop they replace could not be written correctly from
 * out here (kolu#2139). An orchestrator ran three calls — wait for the turn to
 * end, wait for quiet, read the screen — and each gap between two of them is a
 * race: output can move (or settle) between the first and the second, and the
 * screen the third reads is not the screen the second settled on. Inside padi
 * both modifiers are evaluated against the SAME live subscriptions the condition
 * is, so there is no gap to race. The failure that motivated it: `--until
 * awaiting,waiting` fired on an agent whose main loop had ended its turn while a
 * subagent was three minutes into a deliberate plan, and the nudge that followed
 * preempted competent in-flight work.
 *
 * `--settled` is a modifier rather than a fourth `--until` prefix because it is
 * orthogonal to all three: `idle:` + settled, `match:DONE` + settled, and
 * `awaiting,waiting` + settled are each meaningful, and a mode that could be
 * named alongside a disagreeing condition is exactly what the prefix grammar
 * above exists to prevent.
 *
 * ## Every watcher is padi's — one outcome vocabulary
 *
 * Every form rides padi's OWN engine — `awaitTerminalCondition` in
 * `@kolu/padi-client/dial`, which the three named waits kolu's MCP face calls are each
 * a spelling of — so a driver gets the same answer whether it speaks argv or
 * MCP. `match:` was the last form to have a hand-rolled watcher in THIS module,
 * and that copy is exactly what a composition root must not own: it consumed
 * `terminalAttach` raw, outside the per-subscription retry fence (so a transport
 * blip killed the wait instead of re-subscribing —
 * `.claude/rules/streaming.md` rule 1), and it raced `terminalExit` in a way
 * that could report a terminal whose sentinel HAD printed as "gone". It lives in
 * `packages/padi/src/cliClient/watch.ts` now, where that subscription spine is
 * written once.
 *
 * What stays here is what is genuinely CLI: the `--until` grammar (the three
 * prefixes, their rejections, and the phrase each condition is named by in a
 * failure line) — argv vocabulary padi has no business knowing.
 *
 * Every form settles into ONE union — `@kolu/surface/wait`'s `WaitOutcome` — so
 * there is exactly one place mapping an outcome to the exit contract
 * ({@link reportOutcome}), and a fourth condition form would inherit it for
 * free. That is also what keeps the codes honest: met → 0, timeout → 2, the
 * terminal exited first → 3, a dropped link → 1. The modifiers change neither
 * the codes nor the arms: a `--settled` wait that never goes quiet is a
 * TIMEOUT, exactly as a condition that never lands is.
 *
 * ## stdout is the screen; stderr is the trailer
 *
 * Without `--snapshot` this verb writes nothing to stdout in plain mode — the
 * outcome IS the exit code. With it, stdout is the `<N>` screen lines and
 * nothing else, so `kolu wait … --snapshot 40 | grep MARK-` matches the
 * terminal's words while the met trailer (`— 4bba claude waiting after 92s`)
 * stays on stderr beside it. Under `--json` neither is written twice: the screen
 * is the frame's `screen` key.
 *
 * ## `--json` is one frame shape for every outcome
 *
 * Every outcome the watcher RETURNS — met, timeout, gone, interrupted, closed —
 * emits the shared `waitOutcomeJson` frame (`{ id, result, … }`) on stdout, so a
 * `--json` driver branches on `result` and never on the exit code. This is
 * `kaval-tui wait --json`'s frame, adopted for all three families; `padi-tui
 * wait --json` printed `{ id, agent }` on `met` and NOTHING on a timeout, which
 * left its only structured consumer doing exit-code archaeology. The agent arm's
 * met payload still carries the full `agent` record, so nothing is lost by the
 * move. A Ctrl+C is the one thing that is NOT a returned outcome (below), so it
 * is the one arm a `--json` driver reads off the exit code: the process is being
 * torn down, and the frame would be a write racing that teardown.
 *
 * ## Ctrl+C — why the interrupted arm is written from a FINALIZER
 *
 * The run edge (`NodeRuntime.runMain`) owns SIGINT and turns it into fiber
 * INTERRUPTION, which Effect's own teardown reports as 130 — exactly this
 * contract's interrupted code. So this verb installs NO competing signal
 * handler. What it does own is the SENTENCE that rides that code, and an
 * interrupt is the one cause it cannot be raised as:
 *
 * Effect 4 latches `_interruptedCause` on the fiber, and every continuation
 * popped afterwards is REPLACED by a re-raise of it — `setInterruptible`'s
 * `contAll` in `effect/internal/effect.ts`. A `catchCause` around an interrupted
 * effect never runs at all (verified against `effect@4.0.0-rc.110`), so
 * `Effect.fail(waitInterrupted(…))` on this path would be swallowed before
 * `main.ts` could print it — which is exactly how the arm came to be dead code
 * while the exit code stayed right. A finalizer is what still runs, so
 * {@link withInterruptReport} writes the line there, from the SAME `exit.ts`
 * constructor {@link reportOutcome} fails with, and the code stays the runtime's
 * own 130 for an interrupts-only cause.
 *
 * Teardown of the subscriptions is structural and separate: the promise-shaped
 * watchers take an abort bound to the caller's SCOPE, and an interrupt closes
 * that scope, so an interrupted wait unwinds its attach/mirror subscriptions the
 * same way a met or timed-out one does.
 */

import { formatWaitMet, shortId, tailLines } from "@kolu/padi/render";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  awaitTerminalCondition,
  type ConditionMet,
  PADI_LINK_CLOSED,
  type TerminalCondition,
  type TerminalConditionOutcome,
  WAIT_STATES,
} from "@kolu/padi-client/watch";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  waitOutcomeJson,
} from "@kolu/surface/wait";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, type Scope } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { waitFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import {
  type CliFailure,
  errorMessage,
  failure,
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

/** The flags Effect CLI parses for `kolu wait` — DERIVED from `waitFlags` in
 *  `cli.ts`, which also carries the shared timer-range rule, so `timeout`
 *  arrives here already inside `isValidTimerMs` (or the parse refused it). */
export type WaitArgs = Command.Command.Config.Infer<typeof waitFlags>;

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

/** What a parsed `--until` asks this verb to block on: padi's own
 *  {@link TerminalCondition} — the wait vocabulary, which this parse only
 *  SPELLS — plus `describe`, the human phrase the timeout/gone lines name
 *  ("timed out … waiting for X to reach <describe>"). The phrase is carried
 *  beside the condition so the failure text can never drift from the condition
 *  that produced it, and it is the half padi has no business knowing. */
export type WaitPlan = {
  readonly condition: TerminalCondition;
  readonly describe: string;
};

/** Parse `--until` into a {@link WaitPlan}, or a loud, actionable message.
 *
 *  Pure, and run BEFORE the dial: a bad spec must not provision a `--host`
 *  daemon we would immediately drop. The `idle:`/`match:` arms are ported from
 *  kaval-tui's `parseUntil` (digits-only, timer-range guard, non-empty valid
 *  regex — each rejection naming the form it belongs to rather than the generic
 *  three); the bucket arm tests each token with padi's `isWaitState` and phrases
 *  its own rejection with all three forms, because a token that is not a bucket
 *  may simply be a mistyped prefix.
 *
 *  Exported for `wait.test.ts`: the whole `--until` grammar is decided here,
 *  with no socket and no tty in the way, so the matrix — including the
 *  empty-match refusal, which is a FALSE-DONE guard and not a typo guard — is
 *  pinned against the parse the product runs. */
export function planUntil(raw: string): Parsed<WaitPlan> {
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
    // A pattern that also matches the EMPTY STRING is a false done-signal, not a
    // permissive one. The engine's scan searches every delta, so `a*`, `x?`,
    // `^`, `.*`, `()` all match at index 0 of the FIRST delta — a shell prompt,
    // a banner, the agent echoing the brief back. `kolu wait` would exit 0
    // before the caller's sentinel ever printed, and a driving loop reading 0 as
    // "the work finished" is told a lie it cannot detect. Every other rejection
    // in this parse catches a TYPO; this one catches a pattern that is spelled
    // correctly and means something the user did not ask for, so it is refused
    // at the same boundary rather than left to surprise a 3am loop. The
    // non-empty-pattern check above only ever caught a bare `match:`.
    if (regex.test("")) {
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

  // The bucket arm. The comma split and its rejection are ARGV grammar, so they
  // live here beside the other two forms rather than in padi — which is what
  // `padi/src/cliClient/watch.ts`'s header says, and what the code contradicted: padi
  // exported the split with a `--until:`-prefixed message, and this caller threw
  // that message away and re-spelled it with `UNTIL_FORMS`, because a token that
  // is not a bucket may simply be a mistyped PREFIX. padi owns `isWaitState`,
  // which is the whole padi-side contract for a token.
  const tokens = waitStateTokens(raw);
  if (tokens === undefined) {
    return {
      kind: "error",
      message: `--until ${JSON.stringify(raw)} is none of the three condition forms:\n${UNTIL_FORMS}`,
    };
  }
  const targets = new Set<string>(tokens);
  return {
    kind: "ok",
    value: {
      condition: { kind: "agent", targets },
      describe: [...targets].join("/"),
    },
  };
}

// ── The outcome, and the one place it becomes an exit code ───────────────────

// The met payload is padi's {@link ConditionMet} — `fired` discriminates the
// three forms, so the JSON projection and the trailer both follow one tag
// rather than guessing from which field is present, and `screen` rides it when
// `--snapshot` asked for one.

/** The human trailer for a met — stderr, because the wait's payload is the exit
 *  code, the screen block, and (under `--json`) the frame, never this line. The
 *  agent arm defers to `formatWaitMet` so the bucket-and-state wording matches
 *  `kolu ls`. */
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

/**
 * Turn a settled outcome into output plus the exit contract — the ONE mapping,
 * shared by all three condition forms.
 *
 * `--json` emits a frame for EVERY arm (before the failing ones raise), so a
 * structured driver reads `result` rather than inferring from the code. The
 * failures carry their own exact stderr line and their own code marker (see
 * `exit.ts`), so nothing here calls `process.exit` — the run edge owns that.
 * Which is also why the error channel is one type: the four arms this raises
 * (1/2/3/130) differ in the CODE THEY CARRY, and this signature used to union
 * four classes that no `catchTag` ever told apart.
 */
function reportOutcome(
  id: TerminalId,
  outcome: TerminalConditionOutcome,
  describe: string,
  json: boolean,
  screenTail: number | undefined,
): Effect.Effect<void, CliFailure> {
  return Effect.gen(function* () {
    // The engine hands back the WHOLE rendered buffer; `--snapshot N` is this
    // face's rendering decision, so the slice happens here — beside `snapshot`'s
    // identical one, through the same `tailLines` (which also drops the trailing
    // blank rows a rendered buffer ends in). The engine asserts the screen is
    // PRESENT when it was asked for, so there is no absent-screen arm to invent.
    const rendered: TerminalConditionOutcome =
      outcome.kind === "met" &&
      screenTail !== undefined &&
      outcome.screen !== undefined
        ? { ...outcome, screen: tailLines(outcome.screen, screenTail) }
        : outcome;

    if (json) {
      // The met payload passes through UNCHANGED. `ConditionMet` is already a
      // closed union with exactly the fields the frame carries, so the
      // three-arm switch this replaced was `(met) => met` written as eighteen
      // lines that had to be edited again for every new field — and if one was
      // forgotten, the `--json` frame silently lost a key the trailer kept. The
      // genuine per-variant work is `metTrailer`'s, where the switch is
      // load-bearing.
      yield* writeJson(
        waitOutcomeJson<ConditionMet>(id, rendered, (m) => m),
        "the wait outcome",
      );
    }

    switch (rendered.kind) {
      case "met":
        if (!json) {
          // stdout is the SCREEN and nothing else, so `kolu wait … --snapshot 40
          // | grep MARK-` matches the terminal's words — the trailer that names
          // the terminal goes to stderr beside it. Under `--json` the screen is
          // already the frame's `screen` key, so neither is written again.
          if (rendered.screen !== undefined) {
            yield* writeOutBlock(rendered.screen, "the screen text");
          }
          yield* writeErr(metTrailer(id, rendered));
        }
        return;
      // The three failing arms pass FACTS; `exit.ts` renders each line beside
      // the code it rides, so neither can drift from the other and the matrix
      // test builds the real instances rather than fabricating stderr.
      case "timeout":
        return yield* Effect.fail(
          waitTimedOut({
            terminal: shortId(id),
            elapsedMs: rendered.elapsedMs,
            describe,
          }),
        );
      case "gone":
        return yield* Effect.fail(
          waitTerminalGone({ terminal: shortId(id), describe }),
        );
      case "interrupted":
        // The watcher RETURNED `interrupted` — its caller's signal aborted
        // without this fiber being interrupted. A Ctrl+C does not arrive here
        // (an interrupt is not a returned outcome, and cannot be raised as a
        // failure either — see the header); {@link withInterruptReport} writes
        // the same sentence from the same constructor on that path.
        return yield* Effect.fail(waitInterrupted({ terminal: shortId(id) }));
      case "closed":
        // The link dropped before the condition landed — a failure, never a
        // clean stop that would look like a met wait.
        // padi's shared sentence — `kolu watch` and `settledSnapshot` report the
        // same event, and two of the three used to name a different program to
        // go check on.
        return yield* Effect.fail(failure(rendered.error ?? PADI_LINK_CLOSED));
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
export function withInterruptReport<A, E, R>(
  id: TerminalId,
  wait: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.onInterrupt(wait, () =>
    writeErr(waitInterrupted({ terminal: shortId(id) }).stderr),
  );
}

/** The phrase a timeout/gone line names — the condition, AND the quiescence
 *  conjunct when one was asked for.
 *
 *  Exported for `wait.test.ts`. A `--settled` timeout that said only "timed out
 *  waiting for 4bba to reach awaiting/waiting" would send its reader looking at
 *  the wrong half: the bucket may well have landed, and it is the QUIET that
 *  never came (the agent's subagent is still printing) — which is the whole
 *  distinction the flag exists to draw. */
export function describeWait(
  plan: WaitPlan,
  settledMs: number | undefined,
): string {
  return settledMs === undefined
    ? plan.describe
    : `${plan.describe} with ${settledMs}ms of output quiet`;
}

/** Run the wait — ONE padi call for every `--until` form and both modifiers, so
 *  `run` below reads as dial → resolve → wait → report whatever was asked for.
 *
 *  The engine is padi's `awaitTerminalCondition`, and it is Promise-shaped, so
 *  it takes the scope-bound `signal` that unwinds its subscriptions. Every
 *  optional is passed as an ABSENT key when unset — the house spelling for an
 *  optional argument here (~33 sites), and the one that keeps reading as "not
 *  asked for" rather than "asked for, as undefined". */
function awaitPlan(
  client: PadiSurfaceClient,
  id: TerminalId,
  plan: WaitPlan,
  opts: {
    readonly timeoutMs: number | undefined;
    readonly settledMs: number | undefined;
    readonly captureScreen: boolean;
    readonly signal: AbortSignal;
    readonly invokedAs: string;
  },
): Effect.Effect<TerminalConditionOutcome, unknown> {
  const { timeoutMs, settledMs, captureScreen, signal } = opts;
  return Effect.tryPromise({
    try: () =>
      awaitTerminalCondition(client, {
        id,
        condition: plan.condition,
        signal,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(settledMs !== undefined ? { settledMs } : {}),
        ...(captureScreen ? { captureScreen } : {}),
        // The verb the USER typed, so a dropped feed under `kolu debrief` does
        // not tell them to re-run a command they never ran.
        retryAdvice: `re-run ${opts.invokedAs}`,
      }),
    catch: (err) => err,
  });
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
  /** The verb the user actually typed. `kolu debrief` expands to this `run`, so
   *  without it the one diagnostic that names a command to re-run would name a
   *  command they never ran — the first drift of "no second face to drift".
   *  Passing your own name is not logic, so the alias stays definitional. */
  invokedAs = "kolu wait",
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const parsed = planUntil(args.until);
    if (parsed.kind === "error")
      return yield* Effect.fail(failure(parsed.message));
    const plan = parsed.value;

    // `--timeout`/`--settled`/`--snapshot` are range-checked by the PARSE
    // (`waitFlags` in `cli.ts`), which is why the engine's RangeError on an
    // out-of-range delay can never be reached from here: the same
    // `isValidTimerMs` guard `idle:<ms>` applies inside its compound grammar,
    // applied once to each flag that has no grammar around it.
    const timeoutMs = args.timeout;
    const settledMs = args.settled;
    const screenTail = args.snapshot;

    const { id, outcome } = yield* withPadi(endpoint, (conn) =>
      Effect.scoped(
        Effect.gen(function* () {
          const signal = yield* abortOnScopeClose;
          const id = yield* resolveTerminal(conn, args.id);
          // The interrupt report wraps the WAIT and nothing before it: the line
          // names a terminal that is still running, which is only a fact once
          // the id has resolved.
          const outcome = yield* withInterruptReport(
            id,
            awaitPlan(conn.client, id, plan, {
              timeoutMs,
              settledMs,
              captureScreen: screenTail !== undefined,
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
      screenTail,
    );
  });
}
