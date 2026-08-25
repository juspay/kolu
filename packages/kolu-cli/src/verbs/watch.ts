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
 * ## Narrowing, and the mute
 *
 * WHICH terminals this invocation reports is ONE value — padi's `WatchScope`,
 * built once from the resolved `<id>` and the resolved mute, and read through
 * padi's one `scopeAdmits`. There is no second predicate here that could agree
 * with the engine today and drift tomorrow.
 *
 * `<id>` is a short id or any unique prefix; `--ignore` takes the same, and both
 * are resolved against ONE read of the live key set before the mirror starts —
 * one snapshot, so a terminal that appears or dies mid-resolution cannot make
 * the two halves describe different fleets.
 *
 * The two halves fail in OPPOSITE directions, deliberately. `<id>` fails closed:
 * name one and nothing else is reported. The mute fails OPEN: an id in it that
 * no terminal answers to is inert, and a terminal that is not in it is always
 * watched — which is the whole point, because a watcher narrowed to the
 * terminals you remembered goes blind to the one you didn't. A scope where every
 * included terminal is also muted can never match, and is refused rather than
 * left to look like a quiet workspace.
 *
 * BOTH feeds print through ONE emit funnel, and `scopeAdmits` there is the
 * correctness boundary — so neither feed can report a terminal this invocation
 * muted. The supervision feed ALSO narrows on the wire (padi trims the snapshot
 * as well as the stream, so a debugging tail costs one terminal's worth of
 * traffic instead of the fleet's), but that is a BANDWIDTH decision sitting on
 * top of the funnel, not a second filter the funnel relies on.
 *
 * `--ignore-self` asks a question argv cannot answer alone — see
 * {@link refuseSelfNotInFleet}, which holds the decision and the reason.
 *
 * ## Liveness
 *
 * `--heartbeat` prints a timestamped alive line on an otherwise silent stdout;
 * WHY it is CLI-only is {@link planHeartbeat}'s docblock, and what the line
 * looks like is `render.ts`'s `formatHeartbeat`.
 *
 * It bypasses the emit funnel — a pulse is not a terminal event, so there is no
 * terminal for the scope to admit — and it rides the verb's OWN `Effect.scoped`
 * lifetime, for the reason spelled at the acquire below.
 *
 * ## Output discipline
 *
 * stdout is the data (`--json` makes it NDJSON, one object per line, so `jq -c`
 * streams it); upstream narration goes to stderr as it happens, because on a
 * live feed a problem the user learns about only at exit is a problem reported
 * too late. It is narration only, though — it never gets to speak for the
 * ending; see `rejection` below.
 */

import {
  CONTAINING_TERMINAL_ENV,
  confirmInFleet,
  containingTerminalId,
} from "@kolu/padi/containingTerminal";
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
  shortId,
} from "@kolu/padi/render";
import { namesWatchKnobs } from "@kolu/padi/watchSpec";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiWatchStatesInput } from "@kolu/padi-client/surface";
import {
  PADI_LINK_CLOSED,
  WAIT_STATES,
  type WaitState,
  watchAgentStates,
  watchTerminals,
} from "@kolu/padi-client/watch";
import {
  scopeAdmits,
  type WatchScope,
  watchScopeOf,
} from "@kolu/padi-client/watchScope";
import { isValidTimerMs, timerRangeMessage } from "@kolu/surface/wait";
import { isTerminalId, type TerminalId } from "@kolu/terminal-vocab/schema";
import { type Cause, Effect, Fiber, Queue, Stream } from "effect";
import type { Command } from "effect/unstable/cli";
import { match } from "ts-pattern";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { watchFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { type CliFailure, errorMessage, failure } from "../exit.ts";
import {
  ambiguousTerminal,
  isConsumerHangup,
  type Parsed,
  resolveTerminalIn,
  type StdoutWriteFailed,
  stdoutLost,
  stdoutSink,
  waitStateTokens,
  warn,
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

// ── The --ignore-self sentences (argv grammar — padi holds the FACT) ────────
//
// padi answers "what did the stamp say"; what a refusal READS like is this
// face's, beside the other --flag sentences. A padi-side sentence cannot name
// `--ignore-self` and `--ignore <id>` without holding one consumer's argv
// grammar for every other consumer — the placement `cliClient/render.ts:192`
// records this repo having litigated once already, over `--until`.

const IGNORE_SELF_UNRESOLVABLE = `--ignore-self: this process is not running inside a kolu terminal (${CONTAINING_TERMINAL_ENV} is unset). Run watch from inside a kolu-owned PTY, or pass --ignore <id>.`;

const ignoreSelfInvalid = (raw: string): string =>
  `--ignore-self: ${CONTAINING_TERMINAL_ENV}=${JSON.stringify(raw)} is not a terminal id.`;

const ignoreSelfNotInFleet = (self: TerminalId): string =>
  `--ignore-self: this padi has never heard of terminal ${shortId(self)} (${CONTAINING_TERMINAL_ENV}) — muting it would mute nobody and report success. You are watching another machine's fleet (--host, or a --socket pointing at a different padi), or a daemon restart has re-keyed the terminals. Pass --ignore <id> naming a terminal this padi owns.`;

/** Resolve `--ignore-self` against this process's containing terminal. BEFORE
 *  the dial: the env is argv-adjacent, and a missing stamp is a usage error,
 *  not a daemon error. WHETHER that terminal is one this padi owns is a roster
 *  question and waits for the roster — see {@link refuseSelfNotInFleet}. */
export function planIgnoreSelf(
  args: WatchArgs,
  env: { readonly [key: string]: string | undefined } = process.env,
): Parsed<TerminalId | undefined> {
  if (!args.ignoreSelf) return { kind: "ok", value: undefined };
  // `returnType` once, rather than the same annotation on all three arms:
  // the arms are the interesting part.
  return match(containingTerminalId(env))
    .returnType<Parsed<TerminalId | undefined>>()
    .with({ kind: "none" }, () => ({
      kind: "error",
      message: IGNORE_SELF_UNRESOLVABLE,
    }))
    .with({ kind: "invalid" }, (self) => ({
      kind: "error",
      message: ignoreSelfInvalid(self.raw),
    }))
    .with({ kind: "ok" }, (self) => ({ kind: "ok", value: self.id }))
    .exhaustive();
}

/** Is the terminal `--ignore-self` resolved to one this padi actually owns?
 *
 *  The half of the flag argv cannot answer: the stamp is read pre-dial (a
 *  missing one is a usage error), but MEMBERSHIP is a roster question and waits
 *  for the roster. It is refused when the answer is no — a mute that mutes
 *  nobody and reports success is worse than a refusal, and `--host`, a
 *  `--socket` aimed at a different padi, and a stamp re-keyed by a daemon
 *  restart all produce exactly that.
 *
 *  The membership TEST is padi's `confirmInFleet`, the fourth arm of the same
 *  sum that answers `none`/`invalid`/`ok` — this face contributes only the
 *  SENTENCE, and `watchOpen.ts` switches on the same arm to say its own. The
 *  arm exists because `endpoint.kind === "host"` was a TRANSPORT-shaped proxy
 *  for it that missed both a sibling padi and a stale stamp.
 *
 *  A VALIDATOR, so it is spelled as one: a sentence when there is something to
 *  say, and nothing when there is not. */
export function refuseSelfNotInFleet(
  self: TerminalId | undefined,
  live: readonly TerminalId[],
): string | undefined {
  if (self === undefined) return undefined;
  const confirmed = confirmInFleet({ kind: "ok", id: self }, live);
  return confirmed.kind === "stray"
    ? ignoreSelfNotInFleet(confirmed.id)
    : undefined;
}

/** One query's verdict, out of `resolveIgnoreQueries`' `match` below — pure
 *  data, so the loop applies it rather than the `match` arms reaching out to
 *  mutate `resolved`/`dropped` themselves. `exhaustive()` is the actual payoff:
 *  a fourth `ResolveResult` arm fails the build here instead of silently
 *  falling through. */
type IgnoreQueryVerdict =
  | { readonly action: "keep"; readonly id: TerminalId }
  | { readonly action: "drop"; readonly query: string }
  | { readonly action: "fail"; readonly message: string };

/** Widen `--ignore` queries against the live roster. Unique prefixes become
 *  full ids; a query that matches nothing is kept if it is already a full id
 *  (stale mute, fail-open) and dropped otherwise (it could never match);
 *  ambiguity still fails — that is two live terminals, not a stale one. */
export function resolveIgnoreQueries(
  queries: readonly string[],
  live: readonly TerminalId[],
): Parsed<{
  readonly ids: readonly TerminalId[];
  /** Prefixes that named nobody — warned on stderr, never muted. Inside the
   *  SUCCESS arm, because that is the only arm it can describe: intersected
   *  across both, the type says a refusal may also carry a drop list. */
  readonly dropped: readonly string[];
}> {
  const resolved: TerminalId[] = [];
  const dropped: string[] = [];
  for (const query of queries) {
    const verdict = match(resolveTerminalId(query, live))
      .with(
        { kind: "found" },
        (result): IgnoreQueryVerdict => ({ action: "keep", id: result.id }),
      )
      .with(
        { kind: "ambiguous" },
        (result): IgnoreQueryVerdict => ({
          // The sentence, and the match LIST, are `shared.ts`'s — the same words
          // `--parent` and the subject id use. Only the no-match POLICY below is
          // this flag's own.
          action: "fail",
          message: ambiguousTerminal(query, result.matches, "--ignore"),
        }),
      )
      .with(
        { kind: "none" },
        (): IgnoreQueryVerdict =>
          // keep a full id (inert at the engine); a prefix that named nobody
          // cannot match a UUID on the wire, so drop it and tell the user —
          // fail-open for the mute, not silent about a typo.
          isTerminalId(query)
            ? { action: "keep", id: query }
            : { action: "drop", query },
      )
      .exhaustive();
    if (verdict.action === "fail") {
      return { kind: "error", message: verdict.message };
    }
    if (verdict.action === "keep") resolved.push(verdict.id);
    else dropped.push(verdict.query);
  }
  return { kind: "ok", value: { ids: resolved, dropped } };
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

/** Everything argv decides, decided BEFORE anything dials — one value, one
 *  error arm, one test surface.
 *
 *  It used to be three `Parsed` locals composed by hand in `run`, three
 *  near-identical `kind === "error"` blocks, and then the raw flag record read
 *  again from inside a hundred-line closure. A fourth flag was a fourth block
 *  plus a fourth chance to place it on the wrong side of the dial — the bug
 *  `cli.ts:209-216` records having already happened once in this binary.
 *
 *  What is NOT here is anything needing the daemon: `<id>` and `--ignore`'s
 *  prefixes are carried across unresolved, because a roster is not argv. */
export interface WatchPlan {
  /** The supervision feed's wire input, or absent for the change tail. */
  readonly supervise?: PadiWatchStatesInput;
  /** What `--ignore-self` resolved to, when it was named. */
  readonly self?: TerminalId;
  /** The liveness pulse interval, or absent for no pulse. */
  readonly heartbeatMs?: number;
  /** `--ignore` queries — ids or prefixes, resolved against the roster. */
  readonly ignore: readonly string[];
  /** The `<id>` query, resolved against the same roster. */
  readonly id?: string;
  /** NDJSON rather than the human table. */
  readonly json: boolean;
}

export function planWatch(
  args: WatchArgs,
  env: { readonly [key: string]: string | undefined } = process.env,
): Parsed<WatchPlan> {
  const supervise = planSupervision(args);
  if (supervise.kind === "error") return supervise;
  const self = planIgnoreSelf(args, env);
  if (self.kind === "error") return self;
  const heartbeat = planHeartbeat(args);
  if (heartbeat.kind === "error") return heartbeat;
  return {
    kind: "ok",
    value: {
      ...(supervise.value === undefined ? {} : { supervise: supervise.value }),
      ...(self.value === undefined ? {} : { self: self.value }),
      ...(heartbeat.value === undefined
        ? {}
        : { heartbeatMs: heartbeat.value }),
      ignore: args.ignore,
      ...(args.id === undefined ? {} : { id: args.id }),
      json: args.json,
    },
  };
}

/** WHICH terminals this invocation reports, resolved against ONE roster
 *  snapshot.
 *
 *  One read, deliberately: `<id>` and `--ignore` used to resolve against two
 *  separate `readTerminalKeys` round trips (two ssh hops under `--host`), so a
 *  terminal that appeared or died between them could flip the never-match
 *  refusal that compares their results. */
export interface WatchTargets {
  /** The resolved `<id>`, kept apart from {@link scope} because the supervision
   *  feed ALSO puts it on the WIRE — padi trims the snapshot as well as the
   *  stream there, which the change tail's collection cannot be asked for. Both
   *  feeds still narrow at the emit funnel; this only saves the traffic. */
  readonly only?: TerminalId;
  readonly scope: WatchScope;
  /** The roster snapshot above, EMPTY when no flag needed one. It is handed to
   *  the mirror as `initialKeys`: a terminal that departed between this read
   *  and the subscribe is then reported gone on the first frame, instead of
   *  never — the read already happened, and dropping it threw that away. */
  readonly live: readonly TerminalId[];
}

/** Emit ONE line for a terminal event — the three decisions every event type
 *  makes, made once: the scope narrowing, the `--json` fork, and the trailing
 *  newline.
 *
 *  Each change-tail handler used to repeat all three, and the supervision batch
 *  loop repeated NONE of them — it queued its lines directly, filtered only by
 *  the ids it had put on the wire. Written per site, an event type can forget
 *  the narrowing and quietly report a terminal the user asked to be muted: a
 *  filter that is only correct because its copies agree. Both feeds ask padi's
 *  ONE `scopeAdmits` here now, so the wire narrowing is a BANDWIDTH decision
 *  and this is the correctness boundary.
 *
 *  The two renderings are THUNKS, so the shape that was not asked for is never
 *  formatted. Exported for the pins: this guard is the only thing standing
 *  between a muted terminal and stdout. */
export function emitFunnel(
  scope: WatchScope,
  json: boolean,
  offer: (line: string) => void,
): (id: TerminalId, asJson: () => string, asHuman: () => string) => void {
  return (id, asJson, asHuman) => {
    if (!scopeAdmits(scope, id)) return;
    offer(json ? asJson() : asHuman());
  };
}

/** Read the roster once and turn the plan's queries into {@link WatchTargets}.
 *
 *  ORDER is part of the contract, and it is shared with `watchOpen.ts`: the
 *  stamp is resolved FULLY — fleet arm included — BEFORE the scope is built, so
 *  one logical request gets one refusal whichever face it arrives on. Exported
 *  for that pin. */
export function resolveWatchTargets(
  client: PadiSurfaceClient,
  plan: WatchPlan,
): Effect.Effect<WatchTargets, unknown> {
  return Effect.gen(function* () {
    const live =
      plan.id !== undefined || plan.ignore.length > 0 || plan.self !== undefined
        ? yield* readTerminalKeys(client)
        : [];
    const strayed = refuseSelfNotInFleet(plan.self, live);
    if (strayed !== undefined) return yield* Effect.fail(failure(strayed));
    const only =
      plan.id === undefined
        ? undefined
        : yield* resolveTerminalIn(plan.id, live);
    const listed = resolveIgnoreQueries(plan.ignore, live);
    if (listed.kind === "error") {
      return yield* Effect.fail(failure(listed.message));
    }
    for (const query of listed.value.dropped) {
      warn(
        `--ignore ${JSON.stringify(query)} matched no terminal — not muting anything for it`,
      );
    }
    const scope = planWatchScope(only, [
      ...listed.value.ids,
      ...(plan.self === undefined ? [] : [plan.self]),
    ]);
    if (scope.kind === "error") {
      return yield* Effect.fail(failure(scope.message));
    }
    return {
      ...(only === undefined ? {} : { only }),
      scope: scope.value,
      live,
    };
  });
}

export function run(
  endpoint: Endpoint,
  args: WatchArgs,
): Effect.Effect<void, unknown> {
  // BEFORE the dial: a mistyped duration is argv, and argv is answerable without
  // a daemon.
  const planned = planWatch(args);
  if (planned.kind === "error") return Effect.fail(failure(planned.message));
  const plan = planned.value;

  return withPadi(endpoint, (conn) =>
    // The verb's OWN scope, like `wait`'s: a lifetime this body opens (the
    // heartbeat's interval) is released by closing it, on every ending —
    // including the interruption a Ctrl+C arrives as.
    Effect.scoped(
      Effect.gen(function* () {
        const { only, scope, live } = yield* resolveWatchTargets(
          conn.client,
          plan,
        );

        const lines = yield* Queue.unbounded<string, Cause.Done>();
        const offer = (line: string): void => {
          // TRAILING newline, in the same queued string as the payload — never a
          // LEADING one: a line terminated by the NEXT write is a line the
          // consumer cannot see until another event happens, which is the
          // one-event lag `watch.e2e.test.ts` pins with `| head -1`.
          Queue.offerUnsafe(lines, `${line}\n`);
        };
        // Every terminal event on EITHER feed goes through this one guard.
        const emitFor = emitFunnel(scope, plan.json, offer);
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
        // skips. Closing the scope is what stops the timer — `heartbeatTimer`
        // below is an ADDITIONAL, narrower clear for the ordinary ending (see
        // where it's read), not a replacement for this one; a second
        // `clearInterval` on an already-cleared handle is a no-op.
        const heartbeatMs = plan.heartbeatMs;
        let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
        if (heartbeatMs !== undefined) {
          const pulse = (): void => {
            offer(
              plan.json
                ? formatHeartbeatJson(Date.now())
                : formatHeartbeat(Date.now()),
            );
          };
          pulse();
          heartbeatTimer = yield* Effect.acquireRelease(
            Effect.sync(() => setInterval(pulse, heartbeatMs).unref()),
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
              // The two feeds share every ending, every diagnostic and the one
              // pump; they differ only in which member they subscribe. So this is
              // the ONLY fork between them — not two verbs, and not two copies of
              // the lifecycle above and below.
              return plan.supervise === undefined
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
                    warn,
                    // The roster we already read: any key here that the first
                    // snapshot does not re-assert departed while we were
                    // resolving, and the mirror reports it gone at once.
                    () => live,
                  )
                : watchAgentStates(
                    conn.client,
                    // The resolved id rides the WIRE, not a local filter: padi
                    // narrows the snapshot as well as the stream, so a debugging
                    // tail costs one terminal's worth of traffic instead of the
                    // fleet's.
                    {
                      ...plan.supervise,
                      ...(only === undefined ? {} : { id: only }),
                      ...(scope.mute === undefined
                        ? {}
                        : { ignoreIds: [...scope.mute] }),
                    },
                    (batch) => {
                      for (const event of batch) {
                        // Through the SAME funnel the change tail uses — a state
                        // event names a terminal, so it is a membership question
                        // of exactly the same kind, and the wire narrowing above
                        // is bandwidth rather than the boundary. Both spellings
                        // are `render.ts`'s, like every other line this verb
                        // prints: the `--json` contract has one owner.
                        emitFor(
                          event.id,
                          () => formatStateEventJson(event),
                          () => formatStateEvent(event),
                        );
                      }
                    },
                    signal,
                    warn,
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

        // Silence the pulse before the queue it feeds stops accepting offers:
        // `Queue.end` moves `lines` past `"Open"`, and `Queue.offerUnsafe` on a
        // non-`"Open"` queue returns `false` rather than throwing — a pulse that
        // fires in the gap between `Queue.end` and the scope's finalizer (below,
        // via `Fiber.join(pump)` and this generator returning) would vanish with
        // nothing to say so. `heartbeatTimer` is undefined when `--heartbeat` was
        // never asked.
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);

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
