/**
 * The CLI face's EXIT CONTRACT, as values.
 *
 * The codes are a user-visible contract — a driving loop branches on them ("the
 * verb said no" vs "my command was wrong" vs "nothing is serving there") — so
 * they live in one module with a test that pins the whole matrix, rather than
 * as five `process.exit(n)` calls scattered through the commands where nothing
 * can see them together.
 *
 *   0    the verb did what it was asked
 *   1    the verb's DECLARED error — its refusal, as JSON on stderr
 *   2    a usage error this face raised (an input that does not decode, an
 *        argument naming no member, a `--json` payload that is not JSON)
 *   3    nothing is serving the endpoint — the dial failed, or the transport
 *        died mid-call
 *   130  interrupted (Ctrl-C)
 *
 * `1` and `2` are the split that matters: a refusal is an ANSWER from the far
 * side and a usage error never reached it, so a loop that retries on 1 must not
 * retry on 2. `3` is separate again because it is about the endpoint, not about
 * the request — the one code that means "try a different `--socket`".
 *
 * ## The whole matrix is here, dispatch included
 *
 * {@link classify} is in this module and not at the projection, because
 * "which arm does this failure land on" is the same fact as "what are the arms":
 * an arm added or reworded elsewhere would edit two files, and the reason the
 * codes live together is that nothing can then see one without the others. What
 * a refusal's JSON BODY contains ({@link refusalLine}) is here for the same
 * reason — it is the exit-1 arm's payload, not a thing the projection knows.
 *
 * ## Another binary's matrix disagrees — settled, per FACE
 *
 * `packages/kolu-cli` publishes its own: `1 = usage error or dropped link`,
 * `2 = wait timed out`, `3 = terminal exited`. Against this face's `2` is a
 * usage error and `3` is an unreachable endpoint — so `2` means two different
 * things across the two binaries, and the parse layer disagrees in lockstep:
 * `kolu`'s `UsageRefused` maps a CLI-library refusal to `1` where `runEdge`
 * maps the same refusal to `2`.
 *
 * The day one binary mounted both faces has arrived: `kolu` fronts this
 * projection as `kolu surface` (`packages/kolu-cli/src/surfaceFace.ts`) beside
 * its native verbs. The ruling is the one this section recorded ahead of it:
 * NO override on this seam — an override would only let the collision ship
 * quietly, the same integer meaning two things inside one binary and no one
 * place to read the truth off. So the matrices stay per-face, and a driver
 * picks the matrix by picking the face:
 *
 *   - the surface face's verbs answer THIS matrix verbatim — each failure
 *     carries its own code, and the binary's run edge passes identity through
 *     rather than re-classifying;
 *   - the native verbs keep theirs;
 *   - the one binary-wide stance is the parse domain: Effect CLI's own
 *     failures (a missing required flag, an unknown option) resolve as the
 *     LIBRARY's brand before any face's handler runs, and `kolu` renders those
 *     exit `1` on every face — the parse stance an operator learns once.
 *   - the one binary-wide fallback is the defect domain: a throw that outruns
 *     EVERY face's arming (a defect inside an `annotate.render`, fired while
 *     the command TREE is materialising, before any verb's own edge exists)
 *     carries no face's tag, so the binary's edge
 *     arms it as the NATIVE crash line — `kolu: <message>`, exit `1` —
 *     whatever face issued it. A script doing `JSON.parse(stderr)` on exit 1
 *     can therefore rely on egress being JSON for every REFUSAL, but a crash
 *     outrunning the arm is prose; that is the contract a face inherits by
 *     riding a binary that owns other faces, and no subtree wrap can change
 *     it — the binary's edge is the last edge before the process, so the wrap
 *     has to live there, where no face's name is left to arm with.
 *
 * Each arm carries the EXACT text it writes, not a fragment a formatter
 * reassembles later, plus `Runtime.errorExitCode` — the marker
 * `NodeRuntime.runMain`'s own teardown reads off the squashed cause. So there is
 * no exit-code ACCESSOR in this module and no exit-code table at the host's run
 * edge: the host pipes its program through {@link reportingRunEdge}, which
 * words the failure, writes the line and re-fails, and the runtime reads the
 * code straight off the error. Neither the line nor the code
 * can drift from the arm that means them, and no command calls `process.exit`.
 *
 * ## 130 is the one arm that is not a value here
 *
 * A Ctrl-C interrupts the fiber; an interruption is not a typed failure, so no
 * `Effect.catch` sees it and no constructor below can be the thing that
 * happens. The code is still the contract's — `Runtime.defaultTeardown` answers
 * an interrupts-only cause with 130 — which is why {@link EXIT} names it: the
 * number is part of the published matrix even though the mechanism is Effect's.
 *
 * ## The name in the message is the BINARY's, not this package's
 *
 * A user reads `olai: no surface at /run/user/1000/olai/surface.sock`, never
 * `surface-cli: …` — the package they installed is not the command they typed.
 * So every constructor takes the binary's own name and puts it in front. That
 * is `info.name` at {@link surfaceCommands}, threaded down, never a constant
 * this package holds.
 */

import { isTransportError } from "@kolu/surface/client";
import { isDeadTransportError, messageOf } from "@kolu/surface/errors";
import { isNoSnapshotFrame } from "@kolu/surface/first-frame";
import { Cause, Data, Effect, Runtime } from "effect";
import { CliError } from "effect/unstable/cli";

/** The published matrix, as data. Exported so a consumer (a host's docs, a
 *  driving script's test) can name the codes rather than re-spell the integers,
 *  and so the matrix test asserts against ONE table. */
export const EXIT = {
  /** The verb did what it was asked. */
  ok: 0,
  /** The verb's own declared error — a refusal from the far side. */
  failed: 1,
  /** A usage error: the request never left this process. */
  usage: 2,
  /** Nothing is serving the endpoint, or the transport died mid-call. */
  unreachable: 3,
  /** Interrupted (Ctrl-C). Effect's own teardown produces it; see the header. */
  interrupted: 130,
} as const;

/** A CLI failure that carries its OWN text and its OWN exit code — the whole
 *  contract above, as one shape.
 *
 *  The arms are CONSTRUCTORS over one class rather than a class each: nothing
 *  discriminates them (no `catchTag` matches one), and four tags for one concept
 *  is a distinction the code has to keep in sync and nothing can read. The code
 *  is DATA, and `Runtime.errorExitCode` is a getter over it.
 *
 *  `errorReported: false` says "this failure has already been reported to the
 *  user": the host prints {@link runEdge}'s one line and Effect's pretty cause
 *  dump on top of it would be noise, not information. */
export class SurfaceCliFailure extends Data.TaggedError("SurfaceCliFailure")<{
  /** Exactly what to write to stderr, newline included. */
  readonly stderr: string;
  readonly code: number;
}> {
  // `override` on both members, and it is NOT decoration this repo could drop.
  // Effect's `YieldableError` declares them, so a consumer compiling these
  // sources under `noImplicitOverride` — which kolu does not set and olai does —
  // gets TS4114 on each and cannot build at all. Raw TypeScript is what these
  // packages ship (no build step), so a consumer's strictness reaches this file
  // directly, and the keyword is the whole of what it costs to stay buildable
  // under a stricter one than ours.
  override get [Runtime.errorExitCode](): number {
    return this.code;
  }
  override readonly [Runtime.errorReported] = false;
}

/** One diagnostic line on stderr in the binary's own voice — the shape every
 *  prose arm below wears, spelled once. Takes the message WITHOUT a newline: a
 *  caller that has to remember `\n` is a caller that can forget it. */
const line = (binary: string, message: string): string =>
  `${binary}: ${message}\n`;

/** A usage error — the request never left this process (exit 2). The argument
 *  did not decode, the `--json` payload was not JSON, the member named nothing.
 *
 *  Its own code, distinct from a refusal's, because only one of the two means
 *  the far side answered. A loop that retries a refusal must not retry a typo. */
export const usage = (binary: string, message: string): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: line(binary, message),
    code: EXIT.usage,
  });

/** Nothing is serving the endpoint (exit 3) — the dial failed, or the transport
 *  died under an in-flight call. `where` names the endpoint as the user spelled
 *  it, because that is the fact they can act on; `detail` is the transport's own
 *  words, kept rather than flattened to "connection failed". */
export const unreachable = (
  binary: string,
  where: string,
  detail: string,
): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: line(binary, `no surface at ${where} — ${detail}`),
    code: EXIT.unreachable,
  });

/** There is no endpoint to dial (exit 3) — the host's own resolution came up
 *  empty, or threw.
 *
 *  The SAME arm as a failed dial, deliberately: both mean there is no surface to
 *  reach, and the one thing a user does about either is point the binary
 *  somewhere else. It is separate from {@link unreachable} only because there is
 *  no `where` to name — that is precisely what resolution failed to produce. */
export const unresolvable = (
  binary: string,
  detail: string,
): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: line(binary, `no endpoint to dial — ${detail}`),
    code: EXIT.unreachable,
  });

/** The verb's DECLARED error (exit 1) — its refusal, as JSON on stderr.
 *
 *  JSON and not prose, and on stderr and not stdout: a refusal is machine-
 *  readable data the caller can act on ("these three children are not done" is
 *  a list, not a sentence to parse back apart), but it is not the verb's
 *  ANSWER, so it must not land in the stream a pipe is reading. Both halves of
 *  that are the reason this arm exists separately from {@link usage}.
 *
 *  Takes the LINE, already serialized by {@link refusalLine}: the body and the
 *  question of whether it can travel are one decision, and the function that
 *  knows the fallback is the one that must own the `JSON.stringify`. */
const refused = (line: string): SurfaceCliFailure =>
  new SurfaceCliFailure({
    stderr: `${line}\n`,
    code: EXIT.failed,
  });

/** A refusal's machine-readable body, AS THE LINE it will be written as.
 *
 *  A tagged error is already data — carry it whole, so `_tag` and every field the
 *  raiser attached reach the caller. `message` is added only when the value does
 *  not carry one, because a `Data.TaggedError`'s own message is `""` and the
 *  sentence worth reading is in `_tag`. Anything JSON cannot render falls back to
 *  that one sentence rather than failing the write.
 *
 *  One serialization, not two: asking "can this travel?" by stringifying, then
 *  throwing the string away for the caller to stringify again, is the same
 *  question answered twice — and the fallback belongs where the failure is
 *  understood. */
function refusalLine(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const own = { ...(error as Record<string, unknown>) };
    const tag = (error as { readonly _tag?: unknown })._tag;
    const body = {
      ...(typeof tag === "string" ? { _tag: tag } : {}),
      ...own,
      ...(typeof own.message === "string" && own.message !== ""
        ? {}
        : { message: messageOf(error) }),
    };
    try {
      return JSON.stringify(body);
    } catch {
      // A cycle, a BigInt, a throwing getter: the shape cannot travel, but the
      // sentence can — and a refusal that printed nothing would be worse.
    }
  }
  return JSON.stringify({ message: messageOf(error) });
}

/** WHICH arm of the exit contract a failure lands on — the whole dispatch, in
 *  the module that owns the arms.
 *
 *  A failure this face already worded keeps its own verdict. A link that dropped
 *  under an in-flight read, and a TRANSPORT failure, are both exit 3 — the
 *  endpoint stopped answering, which is not the verb's answer. Everything else
 *  is the verb's DECLARED error and rides out as exit 1, as JSON, because a
 *  refusal is data the caller acts on. */
export function classify(
  binary: string,
  where: string,
  error: unknown,
): unknown {
  if (isSurfaceCliFailure(error)) return error;
  // An EMPTY OPEN: the link went away under an in-flight read, discovered by the
  // reader instead of by the dialler. Every snapshot-then-deltas member opens
  // with its current value, so a member that opened and closed saying nothing is
  // the endpoint going away mid-read — which is the same event as a failed dial
  // and not the verb's answer, and would otherwise land on exit 1, the one code
  // that means the far side spoke.
  //
  // Asked HERE, of the framework's OWN tag, and not re-raised as a CLI-local
  // value at each read site. `isNoSnapshotFrame` is the predicate
  // `firstFrameOrThrow` mints its failure for, so a second tagged class whose
  // only journey was reader → classifier asked one question twice and decided
  // two of the five arms a package away from the module that publishes them.
  //
  // ONLY that tag, never the whole failure channel: `firstFrameOrThrow` fails on
  // the stream's own error too, and re-wording those as "no surface at …" told a
  // driver to try a different socket for a member that had answered.
  if (isNoSnapshotFrame(error)) {
    return unreachable(binary, where, messageOf(error));
  }
  if (isTransportError(error) || isDeadTransportError(error)) {
    return unreachable(binary, where, messageOf(error));
  }
  return refused(refusalLine(error));
}

/** Is this a failure this face already worded and gave a code to? Matched on the
 *  tag rather than by `instanceof`, so a value that crossed a module boundary is
 *  still recognised as its own verdict rather than re-classified as a refusal.
 *  EXPORTED: the tag string lives HERE, at its minting module — a host binary
 *  whose run edge passes this face's arms through (kolu's `isContractArm`)
 *  composes this predicate rather than re-spelling the literal. */
export function isSurfaceCliFailure(
  value: unknown,
): value is SurfaceCliFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "SurfaceCliFailure"
  );
}

/** What the run edge owes a failed program: the failure to re-fail with, and —
 *  when there is one — the exact line to write before it.
 *
 *  A SUM and not a `stderr` that is sometimes `""`. The empty string stood for a
 *  state with a real name ("the library already rendered this; print nothing"),
 *  it collided with {@link SurfaceCliFailure.stderr}'s documented meaning
 *  ("exactly what to write"), and every host had to hand-write the `!== ""` test
 *  that told the two apart. */
export type RunEdgeReport =
  | {
      readonly kind: "write";
      readonly stderr: string;
      readonly failure: unknown;
    }
  | { readonly kind: "silent"; readonly failure: unknown };

/** What a host's RUN EDGE should do with a failed program: write the line when
 *  the report carries one, then fail with `failure`, whose exit-code marker the
 *  runtime's own teardown reads. {@link reportingRunEdge} is that whole recipe,
 *  and is what a host should reach for; this is the decision underneath it.
 *
 *  This exists so the exit matrix above is TRUE of a real binary rather than
 *  true of the failures this package happens to raise. Two of the five arms are
 *  not this package's to raise at all:
 *
 *    - a refusal from the CLI LIBRARY — a rejected flag, an unknown subcommand,
 *      a value outside a choice — is a usage error by every reading of the
 *      matrix, but it arrives already rendered and carrying no code of ours.
 *      Left alone it takes whatever the host's own catch-all does with it,
 *      which is how "a usage error is exit 2" quietly became "sometimes 2,
 *      sometimes whatever". Here it becomes {@link EXIT.usage}, printing
 *      nothing more, because the library already printed it.
 *    - `--help` and `--version` are ACTION flags in the pinned `effect`: they
 *      print and return SUCCESS, so they never reach this function. That is the
 *      library's choice rather than its contract, which is why the arm above is
 *      written as "a rendered failure is a usage error" and not as "every
 *      CliError is one" — a rendered SUCCESS is not a failure and does not
 *      arrive.
 *
 *  Everything else keeps its own verdict: a {@link SurfaceCliFailure} carries
 *  the exact line it means and the code that goes with it, and an arbitrary
 *  DEFECT rides out on the refusal arm — exit 1, as JSON — rather than as prose
 *  on the code the matrix publishes as "the verb's declared error, as JSON on
 *  stderr". That arm is not a hypothetical it borrows: the server's own
 *  `SurfaceMemberNotExposed` crosses the wire as a defect whenever the serving
 *  face withholds a member this face's map offers, and so does any throw out of
 *  an `annotate.render`. Prose on exit 1 made `JSON.parse(stderr)` throw for the
 *  one code that promises it will not, and left a loop that retries 1 and not 2
 *  retrying a crash for ever. `{@link classify}` already answers "what is an
 *  unclassified failure?" with the same arm; this is that answer at the edge.
 *
 *  ## Catch the CAUSE, not the failure — and why "stdout is data" depends on it
 *
 *  A host must reach this through `Effect.catchCause` + `Cause.squash`, not
 *  `Effect.catch`. A DEFECT is not a failure, so `catch` never sees one — and
 *  the runtime then reports it itself, on the main fiber, through the default
 *  logger, which writes to STDOUT. That drops a log line into the middle of the
 *  data channel a script is reading, and the case is not exotic: the server's
 *  own per-request refusal crosses the wire as a defect whenever the SERVING
 *  face withholds a member this face's map offers, which is the two-gates
 *  arrangement working exactly as designed.
 *
 *  Two rules come with it, both in `host.fixture.ts`, which is the smallest
 *  honest example of the whole edge: an INTERRUPT passes through untouched (that
 *  is Ctrl-C, and its 130 is the runtime's own teardown reading an
 *  interrupts-only cause), and the runtime's error REPORTING is disabled,
 *  because the line is already written here and Effect's would be a second,
 *  differently-worded copy of it — on stdout. */
export function runEdge(error: unknown): RunEdgeReport {
  // {@link isSurfaceCliFailure}, not a duck-test for a `stderr` string: a FOREIGN error
  // that happens to carry one would otherwise be printed raw and lose the arm
  // the matrix means for it.
  if (isSurfaceCliFailure(error))
    return { kind: "write", stderr: error.stderr, failure: error };
  // Has the CLI LIBRARY already put this failure's text on screen? A typo'd
  // subcommand, a rejected flag, a value an enum does not admit — the library
  // renders the reason and the usage itself, so re-reporting it would print the
  // diagnostic twice.
  //
  // `CliError.isCliError` and not a local test. The library brands every one of
  // its errors with a private TypeId and sets `_tag` to the short name
  // (`ShowHelp`, `DuplicateOption`, …), so the obvious-looking
  // `_tag.startsWith("~effect/cli/")` matches nothing and double-prints every
  // diagnostic — and a copy of the TypeId STRING here is a copy of a private
  // constant that could be renamed without a compile error anywhere. The guard
  // is exported; this takes it.
  if (CliError.isCliError(error)) {
    return {
      kind: "silent",
      failure: new SurfaceCliFailure({ stderr: "", code: EXIT.usage }),
    };
  }
  // The refusal arm, deliberately — see the header. A defect that reached here
  // is still the far side (or this face) having something to say, and every path
  // that ends on exit 1 must end as JSON.
  const failure = refused(refusalLine(error));
  return { kind: "write", stderr: failure.stderr, failure };
}

/** The WHOLE run edge, as one combinator: catch the cause, write the line the
 *  arm means, re-fail with the verdict the runtime reads the code off.
 *
 *  ```ts
 *  NodeRuntime.runMain(
 *    Command.run(root, { version }).pipe(reportingRunEdge, Effect.provide(…)),
 *    { disableErrorReporting: true },
 *  )
 *  ```
 *
 *  It takes no binary NAME, and that is a fact about the arms rather than an
 *  omission: every line this edge writes is one an arm already worded (a
 *  {@link SurfaceCliFailure} carries the binary's name in its own text) or a
 *  refusal's JSON, which carries no prose prefix at all on any path — a `demo: `
 *  in front of it would stop it being JSON. The name belongs where the sentence
 *  is built, which is `info.name` at the projection.
 *
 *  Exported because the three moves above are SAFETY-CRITICAL and were being
 *  hand-written by every host: `catchCause` rather than `catch` (a defect is not
 *  a failure, and the runtime's own report of one goes to STDOUT, in the middle
 *  of the data channel a script is reading), the interrupts-only cause passed
 *  through untouched (that is Ctrl-C, and its 130 is the runtime's own
 *  teardown), and the line written before the re-fail (every failure here marks
 *  itself already-reported, so a host that re-fails without writing it exits
 *  with the right code and says NOTHING). A package that published only the
 *  half returning a string left the other half to be re-derived per binary,
 *  which is how "the matrix is true of a real binary" became a thing each host
 *  could get wrong on its own.
 *
 *  `disableErrorReporting: true` stays the HOST's, and is the other half of the
 *  one recipe: it is an argument to `runMain`, which is the host's call and not
 *  this package's to make. Without it the runtime prints a second,
 *  differently-worded copy of the line this already wrote. */
export const reportingRunEdge = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, unknown, R> =>
  Effect.catchCause(effect, (cause) => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
    const report = runEdge(Cause.squash(cause));
    // Written to the descriptor rather than through `Stdio`: this is the edge
    // OUTSIDE the command, where the services the handlers ran under are gone —
    // and stderr is the one channel that must still work when everything else
    // has failed.
    if (report.kind === "write") process.stderr.write(report.stderr);
    return Effect.fail(report.failure);
  });
