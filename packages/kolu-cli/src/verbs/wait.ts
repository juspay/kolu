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
 * ## Two condition families, one outcome vocabulary
 *
 * `idle:` and the buckets ride padi's OWN watchers (`awaitOutputSettled` /
 * `awaitAgentState` in `@kolu/padi/dial`) — the same two primitives kolu's MCP
 * face's `wait_outputSettled` / `wait_agentState` call, so a driver gets the
 * same answer whether it speaks argv or MCP. `match:` has no padi twin, so this
 * module carries the watcher: it rides `terminalAttach` (scanning only `delta`
 * frames — the snapshot is the PRIOR screen, not bytes that arrived since the
 * call) and races `terminalExit` for the gone-signal. Its pure parts — the
 * regex parse, the control-sequence strip, the matched-line slice, the buffer
 * cap — are PORTED from `kaval-tui/src/wait.ts` rather than imported: this
 * package is a pure padi client and may not grow a kaval edge for four
 * functions. Same port-not-extract doctrine `awaitOutputSettled` itself records
 * one layer down.
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
  awaitOutputSettled,
  type PadiSurfaceClient,
  WAIT_STATES,
} from "@kolu/padi/dial";
import { readTerminalKeys } from "@kolu/padi/read";
import { formatWaitMet, parseUntilStates, shortId } from "@kolu/padi/render";
import { isDeadTransportError } from "@kolu/surface/errors";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  type WaitOutcome,
  waitOutcomeJson,
} from "@kolu/surface/wait";
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Option, Queue, type Scope, Stream } from "effect";
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

// ── The `match:` watcher (no padi twin — this module owns it) ────────────────

/** Cap the accumulated match buffer so a long-running `match` wait against a
 *  chatty terminal can't grow it unbounded. Far larger than any realistic
 *  sentinel/marker, so a match near the tail (the normal case — the marker is
 *  the newest output) is never lost to the trim. Ported from kaval-tui. */
const MATCH_BUFFER_CAP = 1 << 16;

/** Strip VT control sequences (OSC + CSI) and `\r` so a `matchedLine` reads
 *  cleanly in the human/JSON output. The match itself runs against the RAW bytes
 *  (so an escape between two letters can't hide a sentinel from the regex); this
 *  only tidies the REPORTED line. OSC is stripped too because a shell prompt's
 *  title-set (`\x1b]0;…\x07`/ST-terminated) routinely leads a line, and a
 *  CSI-only strip would leave those bytes raw in the JSON frame. Ported from
 *  kaval-tui. */
function cleanLine(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC … (BEL- or ST-terminated)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI
    .replace(/\r/g, "")
    .trim();
}

/** The (cleaned) line of `buffer` containing the match at `index` — so the
 *  caller sees WHICH output line tripped the regex. Ported from kaval-tui. */
function matchedLineAt(buffer: string, index: number): string {
  const start = buffer.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nl = buffer.indexOf("\n", index);
  return cleanLine(buffer.slice(start, nl === -1 ? buffer.length : nl));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One thing that happened on the output feed, as a value. The feed ENDING is a
 *  tick like any other rather than the queue's own end, which is what keeps the
 *  scan loop free of end-of-stream plumbing: a `take` can only be answered by a
 *  frame or by the end, so those are the only two cases it spells. The frame is
 *  typed structurally (`kind`/`data`) — the scan needs a `delta`'s bytes and
 *  nothing a `snapshot` adds. */
type Tick =
  | {
      readonly kind: "frame";
      readonly msg: { readonly kind: string; readonly data?: string };
    }
  | { readonly kind: "feed-ended" };

/**
 * Block until terminal `id`'s NEW output matches `regex`, then succeed `met`; or
 * `timeout`, or `gone` if the terminal exits first, or `closed` if the feed is
 * dropped under us.
 *
 * The race IS the shape — four things can end this wait and each is one arm of a
 * single `raceAllFirst`: the regex lands, the terminal exits, the output feed
 * ends, or `--timeout` elapses. First to SETTLE (not first to succeed), so a
 * dead transport is a failure that WINS the race instead of being ignored while
 * the wait runs on to its timeout.
 *
 * A non-verbatim twin of kaval-tui's `awaitOutputCondition`, rebound to
 * padiSurface's members: `terminalAttach` for the bytes, `terminalExit` for the
 * precise exit signal, and the `terminals` key set for the lost-feed
 * discrimination — the same three padi's own `awaitOutputSettled` binds.
 */
function awaitOutputMatch(
  client: PadiSurfaceClient,
  opts: {
    readonly id: TerminalId;
    readonly regex: RegExp;
    readonly timeoutMs: number | undefined;
  },
): Effect.Effect<KoluWaitOutcome, unknown> {
  return Effect.scoped(
    Effect.gen(function* () {
      const started = Date.now();
      const elapsed = (): number => Date.now() - started;
      /** The first upstream failure a watcher observed — preferred over the
       *  generic dropped-feed message when a lost feed settles `closed`. */
      let feedError: string | undefined;

      // The feed, drained into a queue by its own fiber. The queue is what lets
      // the scan loop say "give me the next frame" without also owning the
      // stream's lifecycle: the forked fiber dies with this scope.
      const ticks = yield* Queue.unbounded<Tick>();
      yield* Effect.forkChild(
        Stream.runForEach(
          client.surface.terminalAttach.get({ id: opts.id }),
          (msg: { kind: string; data?: string }) =>
            Effect.sync(() => {
              Queue.offerUnsafe(ticks, { kind: "frame", msg });
            }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              feedError ??= errMessage(cause);
            }),
          ),
          Effect.andThen(
            Effect.sync(() => {
              Queue.offerUnsafe(ticks, { kind: "feed-ended" });
            }),
          ),
        ),
      );

      /** The output feed dropped before any outcome. Two causes, told apart by
       *  the live key set exactly as padi's own `awaitOutputSettled` does: the
       *  terminal EXITED (its id left the collection → `gone`), or it is still
       *  listed and we were dropped as a slow subscriber (→ `closed`, loud —
       *  never a fabricated `gone`). Either way it SETTLES: a scan that simply
       *  stopped reading would otherwise hang to the timeout. */
      const classifyLostFeed: Effect.Effect<KoluWaitOutcome, unknown> =
        Effect.flatMap(
          Effect.catch(
            Effect.map(readTerminalKeys(client), (ids) =>
              ids.includes(opts.id),
            ),
            (err) => {
              // A dead transport poisons the link — it PROPAGATES rather than
              // being reported as a benign `closed`.
              if (isDeadTransportError(err)) return Effect.fail(err);
              feedError ??= errMessage(err);
              // Liveness unknown: fall through to `closed`, the honest report.
              return Effect.succeed(true);
            },
          ),
          (stillListed): Effect.Effect<KoluWaitOutcome> =>
            stillListed
              ? Effect.succeed({
                  kind: "closed",
                  error:
                    feedError ??
                    `padi ended ${shortId(opts.id)}'s output feed while its terminal was still live (a slow-consumer drop) — re-run \`kolu wait\`.`,
                })
              : Effect.succeed({ kind: "gone", elapsedMs: elapsed() }),
        );

      /** The scan: pull frames until one carries the regex, or the feed ends. */
      const matchArm: Effect.Effect<KoluWaitOutcome, unknown> = Effect.gen(
        function* () {
          let buffer = "";
          for (;;) {
            const tick = yield* Queue.take(ticks);
            if (tick.kind === "feed-ended") return yield* classifyLostFeed;
            // Scan NEW output only — a `snapshot` frame is the replay of the
            // screen as it already was, not bytes that arrived since the call,
            // so matching it would report a marker printed minutes ago.
            if (tick.msg.kind !== "delta") continue;
            buffer += tick.msg.data ?? "";
            const m = opts.regex.exec(buffer);
            if (m !== null) {
              return {
                kind: "met",
                fired: "match",
                elapsedMs: elapsed(),
                matchedLine: matchedLineAt(buffer, m.index),
              };
            }
            // Bound the buffer (keeping the tail, where a sentinel lands) so a
            // chatty terminal that never matches can't grow it without limit.
            if (buffer.length > MATCH_BUFFER_CAP) {
              buffer = buffer.slice(-MATCH_BUFFER_CAP);
            }
          }
        },
      );

      /** `terminalExit` is the PRECISE "the child exited → gone" signal, but
       *  losing it is not fatal: a real exit also ends the attach feed, so
       *  {@link classifyLostFeed} is the backstop and a healthy feed keeps the
       *  scan and the timeout working. So a failure here parks this arm forever
       *  rather than settling the race — and is deliberately NOT recorded into
       *  `feedError`, which only ever surfaces through the `closed` path the
       *  other arm owns. */
      const exitArm: Effect.Effect<KoluWaitOutcome, never> = Effect.catchCause(
        Effect.flatMap(
          Stream.runHead(client.surface.terminalExit.get({ id: opts.id })),
          (head): Effect.Effect<KoluWaitOutcome> =>
            Option.isSome(head)
              ? Effect.succeed({ kind: "gone", elapsedMs: elapsed() })
              : // The stream ended without yielding: not evidence of an exit, so
                // leave the verdict to the feed arm rather than inventing one.
                Effect.never,
        ),
        () => Effect.never,
      );

      const arms: Effect.Effect<KoluWaitOutcome, unknown>[] = [
        matchArm,
        exitArm,
      ];
      if (opts.timeoutMs !== undefined) {
        arms.push(
          Effect.map(
            Effect.sleep(opts.timeoutMs),
            (): KoluWaitOutcome => ({
              kind: "timeout",
              elapsedMs: elapsed(),
            }),
          ),
        );
      }
      return yield* Effect.raceAllFirst(arms);
    }),
  );
}

// ── The verb ─────────────────────────────────────────────────────────────────

// The id-or-prefix widening is `./shared.ts`'s `resolveTerminal`. Worth knowing
// here: an empty `$id` resolves to NOTHING (see `resolveTerminalId`), so a
// driver whose variable went empty is told so instead of waiting on whichever
// terminal happened to be the only one.

/** An abort that fires when the caller's scope closes — the handle the
 *  promise-shaped watchers need to unwind their subscriptions.
 *
 *  Both padi watchers take an `AbortSignal` and document that it must be
 *  threaded into every subscription they open; a fiber interruption (the run
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
 *  The two padi-owned watchers are Promises, so they take the scope-bound
 *  `signal`; the `match` watcher is Effect-native, so its race unwinds with the
 *  fiber and there is no signal to thread. */
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
      return awaitOutputMatch(client, { id, regex: plan.regex, timeoutMs });
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
