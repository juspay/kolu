/**
 * `kolu watch [<id>] [--json]` — FOLLOW the terminals live, until something
 * stops us.
 *
 * Every other verb answers a question and leaves. This one is the only verb
 * that never finishes on its own: it mirrors padi's `terminals` collection and
 * prints a line per change (a terminal appeared, its record moved, it went
 * away) plus the byte-activity transitions (`● busy` / `○ idle`) that say a
 * terminal is doing something RIGHT NOW. That is what makes it the verb a
 * driving agent tails while its sibling works.
 *
 * ## Four endings, and two of them are failures
 *
 * A live monitor has to tell "you stopped me" from "I lost the thing I was
 * watching", because a script that treats a dropped link as EOF silently stops
 * reporting and looks exactly like a quiet system:
 *
 *   - **The user stopped us** (Ctrl+C). The run edge — `NodeRuntime.runMain` in
 *     `main.ts` — interrupts the main fiber on SIGINT/SIGTERM, so this verb
 *     installs NO signal handlers of its own (padi-tui had to, because it ran
 *     on a bare `Effect.runPromise`; here the same wiring would be a second,
 *     competing stop path). It only has to make the interrupt REACH the mirror,
 *     which it does by handing `watchTerminals` the `AbortSignal` that
 *     `Effect.tryPromise` derives from fiber interruption (D10/#18: cancellation
 *     IS fiber interruption). Nothing is failed on this path; the exit code is
 *     the run edge's to decide, per the no-`process.exit`-in-a-verb rule.
 *   - **The consumer hung up** (`kolu watch | head -1`). The stdout sink dies
 *     with EPIPE, which is not an exit-code arm — the caller got the lines it
 *     asked for — so it stops the same watch and returns success.
 *   - **stdout genuinely died** (a full disk, a revoked descriptor). It stops
 *     the watch identically, because nothing can be delivered now — but it is a
 *     FAILURE (exit 1) that NAMES node's own error, never a silent success: a
 *     `watch` that lost its output and exited 0 is indistinguishable, to the
 *     loop above it, from one that had nothing to report. The
 *     EPIPE-vs-everything-else decision and the sentence it prints are
 *     `./shared.ts`'s `writeOut` ones — the same question asked of a streaming
 *     sink instead of a one-shot write.
 *   - **The link dropped.** The mirror settled although nobody asked it to.
 *     That is a FAILURE (exit 1) carrying the mirror's own rejection message —
 *     or padi's shared `PADI_LINK_CLOSED` line when it merely settled — never a
 *     clean EOF.
 *
 * The discrimination stays structural rather than re-derived after the fact. The
 * mirror can only settle by itself when the link closed, and the two stdout
 * deaths are the only things that abort it locally — so `stopped.signal.aborted`,
 * read at the instant the mirror ended, separates "we ended it" from "it ended
 * us". WHICH stdout death it was rides the pump's own error channel, which
 * `Fiber.join` surfaces before that test is ever reached.
 *
 * ## Backpressure, and why lines ride a queue
 *
 * `watchTerminals` hands frames to SYNCHRONOUS callbacks; stdout is a pipe that
 * can refuse to take more. So the handlers only enqueue, and a forked pump
 * drains the queue into a backpressure-aware sink — a slow `| less` applies real
 * backpressure instead of growing an unnamed chain of pending promises. Ending
 * the queue is what FLUSHES it, which gives the two non-interrupt endings a
 * definite "everything printed" point to join on before the verb returns.
 * (On Ctrl+C the run edge interrupts everything, so lines stdout has not yet
 * accepted are dropped: waiting uninterruptibly on a pipe that may never drain
 * is a worse failure mode than losing the tail of a feed the user just stopped.)
 *
 * ## Two feeds, one verb
 *
 * Naming any of `--states` / `--held-for` / `--nag` switches this verb from the
 * CHANGE tail described above to the SUPERVISION feed: agent-state transitions,
 * debounced by a hold and repeated on a nag, led by the currently-matching set.
 * They are different questions — "what just changed in the workspace" and "what
 * has been sitting unattended" — and the second one is the reason the first was
 * never usable as an alert: it relays byte-level churn (an idle grok repaints
 * about once a second), it only shows CHANGES (join late and standing neglect is
 * invisible), and it never repeats itself (ignore a line and it is gone).
 *
 * The switch is the PRESENCE of a knob, not a mode flag, so there is nothing to
 * set inconsistently with the knobs. And the knobs themselves are padi's: this
 * file parses argv into them and prints what comes back, and does not filter,
 * debounce, or remember anything — the same three knobs reach the same engine
 * from the MCP face, so there is no second implementation to drift.
 *
 * ## Narrowing, and output discipline
 *
 * `<id>` is a short id or any unique prefix, resolved once against the live key
 * set before the mirror starts. It filters at the EMIT funnel rather than
 * opening a different subscription, because padi's collection is the whole
 * terminals set either way — one mirror, one filter.
 *
 * stdout is the data (`--json` makes it NDJSON, one object per line, so `jq -c`
 * streams it); upstream narration goes to stderr as it happens, because on a
 * live feed a problem the user learns about only at exit is a problem reported
 * too late. It is narration only, though — it never gets to speak for the
 * ending; see `rejection` below.
 */

import {
  containingTerminalId,
  ignoreSelfInvalid,
  ignoreSelfNotThisFleet,
  ignoreSelfUnresolvable,
  namesWatchKnobs,
  PADI_LINK_CLOSED,
  scopeAdmits,
  WAIT_STATES,
  type WaitState,
  watchAgentStates,
  type WatchScope,
  watchScopeOf,
  watchTerminals,
} from "@kolu/padi/dial";
import { readTerminalKeys } from "@kolu/padi/read";
import {
  formatHeartbeat,
  formatHeartbeatJson,
  formatStateEvent,
  formatStateEventJson,
  formatWatchActivity,
  formatWatchActivityJson,
  formatWatchEvent,
  formatWatchJson,
  formatWatchRemoval,
  formatWatchRemovalJson,
  resolveTerminalId,
} from "@kolu/padi/render";
import type { PadiWatchStatesInput } from "@kolu/padi/surface";
import { isValidTimerMs, timerRangeMessage } from "@kolu/surface/wait";
import { isTerminalId, type TerminalId } from "@kolu/terminal-vocab/schema";
import { type Cause, Effect, Fiber, Queue, Stream } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { watchFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, errorMessage, failure } from "../exit.ts";
import {
  ambiguousTerminal,
  isConsumerHangup,
  type Parsed,
  resolveTerminal,
  type StdoutWriteFailed,
  stdoutLost,
  stdoutSink,
  waitStateTokens,
  writeErrSync,
} from "./shared.ts";

/** What the command tree parsed for `watch` — DERIVED from `watchFlags` in
 *  `cli.ts`. `id` is a terminal id or unique prefix to narrow to; `undefined`
 *  means every one. */
export type WatchArgs = Command.Command.Config.Infer<typeof watchFlags>;

/** Drain ready-to-print lines into stdout until the queue ENDS, or until stdout
 *  dies under us.
 *
 *  The sink, the EPIPE test and the failure sentence are all `./shared.ts`'s:
 *  one block and a live feed differ in SHAPE, not in what can go wrong with a
 *  descriptor. (This file used to say exactly that in a comment and then write
 *  all three out again.) What is genuinely local is that a dead stdout must STOP
 *  the mirror rather than merely resolve a write — `stop` aborts it, because a
 *  feed with nowhere to go is not a feed — and only the REPORT differs: a hangup
 *  is a complete run (success), anything else fails on this effect's error
 *  channel. The caller joins this fiber, which is where that failure becomes the
 *  verb's. */
const pumpToStdout = (
  lines: Queue.Dequeue<string, Cause.Done>,
  stop: () => void,
): Effect.Effect<void, CliFailure> => {
  const drain: Effect.Effect<void, StdoutWriteFailed> = Stream.run(
    Stream.fromQueue(lines),
    stdoutSink,
  );
  return Effect.catchTag(drain, "StdoutWriteFailed", (err) =>
    Effect.flatMap(Effect.sync(stop), () =>
      isConsumerHangup(err.cause)
        ? // The reader left — that is a complete watch, not an error to report.
          Effect.void
        : Effect.fail(stdoutLost("the watch feed", err.cause)),
    ),
  );
};

// ── The supervision grammar (argv only — the semantics are padi's) ──────────
//
// The same division `kolu wait` draws for `--until`: padi owns what a bucket IS
// (`isWaitState`) and what a knob MEANS; how a comma list and a duration are
// SPELLED, and what a rejection reads like, is argv grammar and lives here. And
// it is decided BEFORE the dial, so `--held-for banana` is refused instantly
// rather than after a `--host` has ssh-provisioned a cold box.

/** How long, spelled the way a person writes it — and the unit is OPTIONAL,
 *  because a bare number in this binary already means milliseconds.
 *
 *  `--timeout 10000`, `--settled 15000` and `--until idle:2000` are all bare
 *  millisecond integers, so refusing `--held-for 60000` would make one binary
 *  hold two mutually-refusing duration grammars — a user who has learned the
 *  other four flags gets an error for spelling this one the same way. One
 *  grammar, then: milliseconds, with a suffix for the two flags whose natural
 *  values are minutes and hours (nobody wants to read `--nag 300000`). The
 *  suffix is a convenience ON the existing spelling, not a second one. */
const DURATION = /^(\d+)(ms|s|m|h|d)?$/;
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  // `d`, because `relativeTime` — the fold this feed's hold column is RENDERED
  // with — emits `2d`. A grammar you can read out of the output and not type
  // back in is half a grammar, and the ceiling is ~24.8 days, so `1d`–`24d` are
  // all values the feed can print.
  d: 86_400_000,
};

/** Read a duration for `flag`, refusing anything below `min`.
 *
 *  `min` is a PARAMETER because it is the flag's own fact and the flag's own
 *  sentence: a hold of 0 means "report it the instant it enters", an interval of
 *  0 is a spin. It used to be an `ms !== 0` escape inside this parser plus a
 *  compensating check at one caller — one rule at two depths, and invisible to
 *  the third duration flag that would inherit the escape by accident. */
function parseDuration(
  flag: string,
  raw: string,
  min: { readonly ms: number; readonly why: string },
): Parsed<number> {
  const m = DURATION.exec(raw.trim());
  if (m === null) {
    return {
      kind: "error",
      message: `--${flag} ${JSON.stringify(raw)} is not a duration. Write a whole number of milliseconds (60000), or add a unit: 500ms, 60s, 5m, 2h, 1d.`,
    };
  }
  // An omitted unit is `ms` — see the grammar note above.
  const ms =
    Number(m[1]) * (m[2] === undefined ? 1 : (UNIT_MS[m[2]] as number));
  if (ms < min.ms) {
    return { kind: "error", message: `--${flag} ${raw}: ${min.why}` };
  }
  if (ms > 0 && !isValidTimerMs(ms)) {
    // The one ceiling sentence, from the module that owns the ceiling — so a
    // user who overshoots `--timeout` and one who overshoots `--nag` are taught
    // the same limit in the same words.
    return {
      kind: "error",
      message: timerRangeMessage(flag, "fires immediately, forever", raw),
    };
  }
  return { kind: "ok", value: ms };
}

/** What the three knobs add up to — the wire input, or `undefined` when the user
 *  named none of them and wants the change tail instead.
 *
 *  Only the knobs the user actually SPELLED ride the wire; the defaults live in
 *  padi, once, so the CLI and an MCP orchestrator that named no states are
 *  watching the same thing rather than two constants that agree today. */
export function planSupervision(
  args: WatchArgs,
): Parsed<PadiWatchStatesInput | undefined> {
  const input: {
    states?: readonly WaitState[];
    heldForMs?: number;
    nagMs?: number;
  } = {};
  if (args.states !== undefined) {
    const tokens = waitStateTokens(args.states);
    if (tokens === undefined) {
      return {
        kind: "error",
        message: `--states ${JSON.stringify(args.states)} is not a list of agent buckets. Pick from ${WAIT_STATES.join(", ")}, comma-separated (any-of).`,
      };
    }
    input.states = tokens;
  }
  if (args.heldFor !== undefined) {
    const parsed = parseDuration("held-for", args.heldFor, {
      ms: 0,
      // Zero IS the hold's identity element — report it the instant it enters.
      why: "a hold cannot be negative.",
    });
    if (parsed.kind === "error") return parsed;
    input.heldForMs = parsed.value;
  }
  if (args.nag !== undefined) {
    const parsed = parseDuration("nag", args.nag, {
      ms: 1,
      why: "an interval of zero is a spin, not a fast nag — it would re-report every terminal as fast as the daemon can loop. Pass a real interval (5m), or leave --nag off to be told once.",
    });
    if (parsed.kind === "error") return parsed;
    input.nagMs = parsed.value;
  }
  // The PRESENCE of a knob IS the choice of feed — asked of padi's ONE
  // definition rather than re-listed here. A fourth knob then reaches this face
  // by being declared, instead of leaving the CLI quietly on the change tail for
  // a user who named it.
  return { kind: "ok", value: namesWatchKnobs(input) ? input : undefined };
}

/** `--heartbeat` is CLI-only: a line on a held stdout. MCP `watch_next` already
 *  answers "still nothing" with `timeoutMs`; a clock tick in the padi queue
 *  would mix a liveness pulse into terminal events. Naming it does NOT switch
 *  the feed — it is not a supervision knob. */
export function planHeartbeat(args: WatchArgs): Parsed<number | undefined> {
  if (args.heartbeat === undefined) return { kind: "ok", value: undefined };
  const parsed = parseDuration("heartbeat", args.heartbeat, {
    ms: 1,
    why: "an interval of zero is a spin, not a fast heartbeat. Pass a real interval (10s), or leave --heartbeat off.",
  });
  if (parsed.kind === "error") return parsed;
  return { kind: "ok", value: parsed.value };
}

/** Resolve `--ignore-self` against this process's containing terminal. BEFORE
 *  the dial: the env is argv-adjacent, and a missing stamp is a usage error,
 *  not a daemon error. Prefixes on `--ignore` wait for the live roster.
 *
 *  The ENDPOINT is part of the question, not context: the stamp names a
 *  terminal on THIS machine, so `--host` asks to mute it in a fleet that has
 *  never heard of it. Fail-open would make that a silent no-op reporting
 *  success — the one thing `--ignore-self` refuses to do anywhere else. */
export function planIgnoreSelf(
  args: WatchArgs,
  endpoint: Endpoint,
  env: { readonly [key: string]: string | undefined } = process.env,
): Parsed<TerminalId | undefined> {
  if (!args.ignoreSelf) return { kind: "ok", value: undefined };
  if (endpoint.kind === "host") {
    return { kind: "error", message: ignoreSelfNotThisFleet(endpoint.ssh) };
  }
  const self = containingTerminalId(env);
  if (self.kind === "none") {
    return { kind: "error", message: ignoreSelfUnresolvable("cli") };
  }
  if (self.kind === "invalid") {
    return { kind: "error", message: ignoreSelfInvalid(self.raw, "cli") };
  }
  return { kind: "ok", value: self.id };
}

/** Widen `--ignore` queries against the live roster. Unique prefixes become
 *  full ids; a query that matches nothing is kept if it is already a full id
 *  (stale mute, fail-open) and dropped otherwise (it could never match);
 *  ambiguity still fails — that is two live terminals, not a stale one. */
export function resolveIgnoreQueries(
  queries: readonly string[],
  live: readonly TerminalId[],
): Parsed<readonly TerminalId[]> & { readonly dropped?: readonly string[] } {
  const resolved: TerminalId[] = [];
  const dropped: string[] = [];
  for (const query of queries) {
    const result = resolveTerminalId(query, live);
    if (result.kind === "found") {
      resolved.push(result.id);
      continue;
    }
    if (result.kind === "ambiguous") {
      // The sentence, and the match LIST, are `shared.ts`'s — the same words
      // `--parent` and the subject id use. Only the no-match POLICY below is
      // this flag's own.
      return {
        kind: "error",
        message: ambiguousTerminal(query, result.matches, "--ignore"),
      };
    }
    // none: keep a full id (inert at the engine); a prefix that named nobody
    // cannot match a UUID on the wire, so drop it and tell the user — fail-open
    // for the mute, not silent about a typo.
    if (isTerminalId(query)) resolved.push(query);
    else dropped.push(query);
  }
  return { kind: "ok", value: resolved, dropped };
}

/** WHICH terminals this invocation reports — padi's one scope value, built from
 *  the resolved `<id>` and the resolved mute.
 *
 *  The never-match refusal is the CONSTRUCTOR's (`kolu watch <id> --ignore-self`
 *  inside that same terminal is a watch whose only member is muted); this adds
 *  the way OUT in argv's own grammar, which is the half padi must not hold. */
export function planWatchScope(
  only: TerminalId | undefined,
  mute: readonly TerminalId[],
): Parsed<WatchScope> {
  const scope = watchScopeOf({
    ...(only === undefined ? {} : { ids: [only] }),
    mute,
  });
  if (scope.kind === "error") {
    return {
      kind: "error",
      message: `${scope.message} Omit the id to watch the rest of the fleet, or drop it from --ignore.`,
    };
  }
  return scope;
}

export function run(
  endpoint: Endpoint,
  args: WatchArgs,
): Effect.Effect<void, unknown> {
  // BEFORE the dial: a mistyped duration is argv, and argv is answerable without
  // a daemon.
  const plan = planSupervision(args);
  if (plan.kind === "error") return Effect.fail(failure(plan.message));
  const supervise = plan.value;
  const self = planIgnoreSelf(args, endpoint);
  if (self.kind === "error") return Effect.fail(failure(self.message));
  const beat = planHeartbeat(args);
  if (beat.kind === "error") return Effect.fail(failure(beat.message));

  return withPadi(endpoint, (conn) =>
    // The verb's OWN scope, like `wait`'s: a lifetime this body opens (the
    // heartbeat's interval) is released by closing it, on every ending —
    // including the interruption a Ctrl+C arrives as.
    Effect.scoped(
      Effect.gen(function* () {
        const only =
          args.id === undefined
            ? undefined
            : yield* resolveTerminal(conn, args.id);

        const listed: readonly TerminalId[] =
          args.ignore.length === 0
            ? []
            : yield* Effect.flatMap(readTerminalKeys(conn.client), (keys) => {
                const resolved = resolveIgnoreQueries(args.ignore, keys);
                if (resolved.kind === "error") {
                  return Effect.fail(failure(resolved.message));
                }
                for (const query of resolved.dropped ?? []) {
                  writeErrSync(
                    `kolu: --ignore ${JSON.stringify(query)} matched no terminal — not muting anything for it\n`,
                  );
                }
                return Effect.succeed(resolved.value);
              });
        const planned = planWatchScope(only, [
          ...listed,
          ...(self.value === undefined ? [] : [self.value]),
        ]);
        if (planned.kind === "error") {
          return yield* Effect.fail(failure(planned.message));
        }
        const scope = planned.value;

        const lines = yield* Queue.unbounded<string, Cause.Done>();
        /** Emit ONE line for a terminal event — the three decisions every event
         *  type makes, made once.
         *
         *  Each handler below used to repeat all three: the `only` narrowing, the
         *  `--json` fork, and the trailing newline. Written per handler, a fourth
         *  event type can forget the narrowing and quietly report a terminal the
         *  user asked to be narrowed away — a filter that is only correct because
         *  three copies of it agree. The two renderings are THUNKS so the shape
         *  that was not asked for is never formatted. */
        const offer = (line: string): void => {
          // TRAILING newline, in the same queued string as the payload — never a
          // LEADING one: a line terminated by the NEXT write is a line the
          // consumer cannot see until another event happens, which is the
          // one-event lag `watch.e2e.test.ts` pins with `| head -1`.
          Queue.offerUnsafe(lines, `${line}\n`);
        };
        const emitFor = (
          id: TerminalId,
          json: () => string,
          human: () => string,
        ): void => {
          // ONE membership question, asked of padi's one reader — the `<id>`
          // narrowing and the mute are the same rule, so a fourth event type
          // cannot inherit half of it.
          if (!scopeAdmits(scope, id)) return;
          offer(args.json ? json() : human());
        };
        /** Why the mirror REJECTED, if it did — the only thing upstream ever says
         *  that genuinely names a failure. The `log` lines below are chatter by
         *  contract (`MirrorRemoteSurfaceOptions.log`: "routine narration a
         *  consumer may filter freely — a link ending, a reconnect"), so latching
         *  the first of THOSE would report an ordinary narration line as the
         *  reason the watch died. They still reach stderr as they happen; they
         *  just don't get to speak for the ending. */
        let rejection: string | undefined;

        // Aborted when stdout dies under us — the local half of "stop the watch";
        // the other half is fiber interruption. Whether that death was a hangup or
        // a real write failure rides the pump's error channel, joined below.
        const stopped = new AbortController();
        const pump = yield* Effect.forkChild(
          pumpToStdout(lines, () => stopped.abort()),
        );

        // The pulse rides the SCOPE, like every other lifetime in this verb: a
        // Ctrl+C reaches this process as fiber interruption, and the generator
        // never resumes past the yield below — so a `clearInterval` written as a
        // straight-line statement after it is a disposer the primary ending
        // skips. Closing the scope is what stops the timer.
        if (beat.value !== undefined) {
          const pulse = (): void => {
            offer(
              args.json
                ? formatHeartbeatJson(Date.now())
                : formatHeartbeat(Date.now()),
            );
          };
          pulse();
          yield* Effect.acquireRelease(
            Effect.sync(() => setInterval(pulse, beat.value).unref()),
            (timer) => Effect.sync(() => clearInterval(timer)),
          );
        }

        yield* Effect.catch(
          Effect.tryPromise({
            // `interrupted` is the signal Effect derives from THIS fiber's
            // interruption, so a Ctrl+C at the run edge reaches the mirror
            // without a single `process.on` in this file. Combined with the
            // stdout-death signal because both mean "stop", and the mirror takes
            // one.
            try: (interrupted) => {
              const signal = AbortSignal.any([interrupted, stopped.signal]);
              const narrate = (line: string): void => {
                writeErrSync(`kolu: ${line}\n`);
              };
              // The two feeds share every ending, every diagnostic and the one
              // pump; they differ only in which member they subscribe. So this is
              // the ONLY fork between them — not two verbs, and not two copies of
              // the lifecycle above and below.
              return supervise === undefined
                ? watchTerminals(
                    conn.client,
                    {
                      onUpsert: (id, value, live) =>
                        emitFor(
                          id,
                          () => formatWatchJson(id, value, { live }),
                          () =>
                            formatWatchEvent(id, value, {
                              now: Date.now(),
                              live,
                            }),
                        ),
                      onRemove: (id) =>
                        emitFor(
                          id,
                          () => formatWatchRemovalJson(id),
                          () => formatWatchRemoval(id, { now: Date.now() }),
                        ),
                      onActivity: (id, live) =>
                        emitFor(
                          id,
                          () => formatWatchActivityJson(id, live),
                          () =>
                            formatWatchActivity(id, live, { now: Date.now() }),
                        ),
                    },
                    signal,
                    narrate,
                  )
                : watchAgentStates(
                    conn.client,
                    // The resolved id rides the WIRE, not a local filter: padi
                    // narrows the snapshot as well as the stream, so a debugging
                    // tail costs one terminal's worth of traffic instead of the
                    // fleet's.
                    {
                      ...supervise,
                      ...(only === undefined ? {} : { id: only }),
                      ...(scope.mute === undefined
                        ? {}
                        : { ignoreIds: [...scope.mute] }),
                    },
                    (batch) => {
                      for (const event of batch) {
                        // Both spellings are `render.ts`'s, like every other line
                        // this verb prints — the `--json` contract has one owner.
                        offer(
                          args.json
                            ? formatStateEventJson(event)
                            : formatStateEvent(event),
                        );
                      }
                    },
                    signal,
                    narrate,
                  );
            },
            catch: (err) => err,
          }),
          // A rejection and a self-settle are the same fact — the watch is over —
          // so both land on the one ending below; the rejection just names itself.
          (err) =>
            Effect.sync(() => {
              rejection = errorMessage(err);
            }),
        );

        // Read the discrimination HERE, at the instant the mirror ended, not after
        // the flush: a stdout death always precedes the settle it causes (it is
        // what aborts the mirror), so this is exactly "nobody local asked" — and a
        // reader that hangs up during the final flush can no longer erase a link
        // drop that had already happened.
        const selfSettled = !stopped.signal.aborted;

        // Stop producing and FLUSH what is already queued before leaving: a
        // `watch` that dropped its last lines on the way out is indistinguishable
        // from one that never saw the event.
        yield* Queue.end(lines);
        // A dead-stdout failure is the pump's, and this join is where it becomes
        // the verb's — before the link test below, because "I could not print what
        // I saw" outranks "the feed ended" as the thing that went wrong.
        yield* Fiber.join(pump);

        // The mirror settled and nothing local asked it to — the link dropped.
        if (selfSettled) {
          return yield* Effect.fail(failure(rejection ?? PADI_LINK_CLOSED));
        }
      }),
    ),
  );
}
