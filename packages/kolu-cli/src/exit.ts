/**
 * `kolu`'s EXIT CONTRACT, as values.
 *
 * The codes are a user-visible contract — driving loops branch on them ("the
 * agent I was waiting for died" vs "it never settled" vs "my command was
 * wrong") — so they live in one module with a test that pins the whole matrix,
 * rather than as five `process.exit(n)` calls scattered through the verbs where
 * nothing can see them together.
 *
 *   0    the verb did what it was asked
 *   1    a usage error, or the padi link dropped
 *   2    `wait` ran out of time — the condition never landed
 *   3    `wait`'s terminal exited before reaching the condition
 *   130  interrupted (Ctrl+C / SIGTERM / SIGHUP)
 *
 * This is the contract `padi-tui` and `kaval-tui` each carried a copy of; the
 * verbs that graduated onto `kolu` bring it with them, so a driving loop that
 * branched on those codes keeps working against the new spelling.
 *
 * Each arm carries the EXACT line it writes to stderr, not a fragment a
 * formatter reassembles later, plus `Runtime.errorExitCode` — the marker
 * `NodeRuntime.runMain`'s own teardown reads off the squashed cause. So there is
 * no exit-code ACCESSOR in this module and no exit-code table at the edge:
 * `main.ts` writes the line ({@link reportOf}) and re-fails, and the runtime
 * reads the code straight off the error. Neither the line nor the code can drift
 * from the arm that means them, and no verb calls `process.exit`.
 *
 * The arms are CONSTRUCTORS over one error class, not one class each: see
 * {@link CliFailure}.
 *
 * `errorReported: false` on every one of them says "this failure has already
 * been reported to the user" — the CLI prints its own one-line diagnostic, and
 * Effect's pretty cause dump on top of it would be noise, not information.
 *
 * ## The sentences live here too, as CONSTRUCTORS
 *
 * A verb passes FACTS — the short id, the elapsed ms, the condition it was
 * waiting for — and the arm renders its own line. That is what makes the matrix
 * test able to build real instances rather than fabricating stderr strings no
 * verb ever writes: a test that asserts a shape over its own literals is
 * asserting nothing about the product. Every line starts `kolu: `, including
 * the interrupted one — see {@link waitInterrupted}.
 *
 * ## Every exit-code-bearing class is in here
 *
 * Including the two the faces raise ({@link ReservedFaceError},
 * {@link UsageRefused}), which used to sit in `cli.ts` and `main.ts`. A module
 * whose whole reason to exist is that nothing can see the codes apart cannot
 * hold two thirds of them.
 */

import { Data, Runtime } from "effect";

/** A kolu failure that carries its OWN stderr line and its OWN exit code — the
 *  whole contract above, as one shape.
 *
 *  There used to be four classes here (`CliFailure`, `WaitTimedOut`,
 *  `WaitTerminalGone`, `WaitInterrupted`) with byte-identical bodies, differing
 *  only in the integer. Nothing ever discriminated them: no `catchTag` matched
 *  one, and `wait.ts`'s handler unioned all four back together in the one
 *  signature that named them. Four tags for one concept is a distinction the
 *  code has to keep in sync and nothing can read — so the arms stay four (the
 *  CONSTRUCTORS below, each owning its sentence and its number), and the class
 *  is one.
 *
 *  The code is DATA, and `Runtime.errorExitCode` is a getter over it. That is
 *  still not an exit-code accessor in the sense the header rules out: the marker
 *  is read off the error by the runtime's own teardown (`getErrorExitCode` walks
 *  the prototype chain), never by this package. */
export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly stderr: string;
  readonly code: number;
}> {
  get [Runtime.errorExitCode](): number {
    return this.code;
  }
  readonly [Runtime.errorReported] = false;
}

/** A face the plan RESERVES but has not shipped (`kolu tui`).
 *
 *  `Data.TaggedError`, not `Schema.TaggedError`: this error never crosses a wire
 *  — it is raised and handled inside one process — so it needs a `_tag` to match
 *  on, not a codec. */
export class ReservedFaceError extends Data.TaggedError("ReservedFaceError")<{
  readonly message: string;
}> {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** A rendered CLI-LIBRARY failure the user did not ask for — a bare `kolu`, a
 *  typo'd subcommand, a rejected flag. Exit 1, and it prints NOTHING because the
 *  library already printed the usage and the reason; `main.ts` explains which
 *  library failures reach this and which are a successful run.
 *
 *  Its own shape so the exit-code marker rides the error exactly as every other
 *  arm's does, leaving the teardown one rule rather than a special case. */
export class UsageRefused {
  readonly [Runtime.errorExitCode] = 1;
  readonly [Runtime.errorReported] = false;
}

/** The one-line diagnostic every usage/link failure carries, prefixed once.
 *  Exit 1 — a usage error or a dropped link, which is one thing to a driver
 *  however it was reached. */
export const failure = (message: string): CliFailure =>
  new CliFailure({ stderr: `kolu: ${message}\n`, code: 1 });

/** A flag the user SPELLED but left EMPTY — `--worktree "$NAME"` with `$NAME`
 *  unset, the ordinary shell accident. ONE predicate, so every gate in this
 *  package agrees on what blank IS: whitespace counts, because `--cwd " "` is
 *  the same accident with a quoted space. */
export const isBlank = (value: string): boolean => value.trim() === "";

/** The refusal for a blank flag value, naming the offending flag.
 *
 *  Every such gate says the same two things — WHICH flag was empty, and that an
 *  unset shell variable is the likely cause — so they say it in one sentence
 *  rather than in one sentence per verb. `names` completes "it names …", so it
 *  reads as a noun phrase ("the branch to cut the new worktree on").
 *
 *  `endpointOf` keeps its own longer sentence rather than calling this: it can
 *  name SEVERAL flags at once, and it has to say the extra thing that makes a
 *  blank endpoint the most dangerous of these (kolu will not quietly fall back
 *  to whichever daemon it discovers). It shares the {@link isBlank} rule above,
 *  which is the part that must not drift. */
export const blankFlag = (flag: string, names: string): CliFailure =>
  failure(
    `${flag} was passed with an empty value — an unset shell variable, most likely. It names ${names}; pass one, or drop the flag entirely.`,
  );

/** The named fail-fast for a face that is planned but not shipped. */
export const reservedFace = (face: string): ReservedFaceError =>
  new ReservedFaceError({
    message: `kolu ${face} is not shipped yet — it lands in a later PR of the kolu-cli plan: https://kolu.dev/atlas/kolu-cli.html`,
  });

/** `wait` ran out of time — the condition never landed. Its own code (2) so a
 *  driver tells it from a usage/link error.
 *
 *  Reports the outcome's OWN elapsed (always populated) rather than the
 *  `--timeout` flag, which is optional — a future non-timer timeout route could
 *  otherwise print "undefinedms". */
export const waitTimedOut = (facts: {
  readonly terminal: string;
  readonly elapsedMs: number;
  readonly describe: string;
}): CliFailure =>
  new CliFailure({
    stderr: `kolu: timed out after ${facts.elapsedMs}ms waiting for ${facts.terminal} to reach ${facts.describe}.\n`,
    code: 2,
  });

/** The watched terminal exited before the condition landed — the wait can never
 *  land now. Its own code (3) so a driver tells "the agent I was driving died"
 *  from a timeout (2, still alive but stuck) or an error (1). */
export const waitTerminalGone = (facts: {
  readonly terminal: string;
  readonly describe: string;
}): CliFailure =>
  new CliFailure({
    stderr: `kolu: ${facts.terminal} exited before reaching ${facts.describe} — its terminal is gone.\n`,
    code: 3,
  });

/** A Ctrl+C (or an external stop) during a `wait` — the conventional 130, and it
 *  wears the `kolu: ` prefix like every other arm.
 *
 *  It used to be written `— interrupted; …`, the shape of a SUCCESS trailer
 *  (`metTrailer`'s), which made it the one arm of a stderr contract that a
 *  driving loop could not recognize by the same test as the other three. The
 *  line was the bug, not the rule: this is a FAILURE arm, it rides the error
 *  channel, and it exits 130. `terminal` names what is still running, which is
 *  the fact the user can act on. */
export const waitInterrupted = (facts: {
  readonly terminal: string;
}): CliFailure =>
  new CliFailure({
    stderr: `kolu: interrupted; ${facts.terminal} left running\n`,
    code: 130,
  });

/** The message inside an arbitrary thrown thing — the raw half of
 *  {@link reportOf}, and the one place this package decides what an unknown
 *  thrown thing SAYS.
 *
 *  "Turn an unknown thrown thing into a sentence" is one decision, and it was
 *  re-made inline at five new sites. Every site in this package that renders a
 *  raw rejection is meant to call this rather than spell the ternary again —
 *  the dial (`endpoint.ts`), the dial classifier (`connect.ts`), the `--until
 *  match:` regex refusal (`verbs/wait.ts`), the terminal resolver
 *  (`verbs/shared.ts`) and the live watch (`verbs/watch.ts`) all do. Guarding it
 *  matters: a non-`Error` rejection (a thrown string, a rejected plain object)
 *  read through an unguarded `(err as Error).message` prints `undefined`, which
 *  degrades the one diagnostic that says what broke. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** What the run edge prints for a failed program.
 *
 *  An arm of the contract prints its own exact line. Anything ELSE — a defect, a
 *  raw rejection from a dependency — is still reported, in the CLI's one-line
 *  shape: a failure that printed nothing would be the silent-degradation this
 *  repo treats as a defect. */
export function reportOf(error: unknown): string {
  const e = error as { readonly stderr?: unknown; readonly message?: unknown };
  if (typeof e?.stderr === "string") return e.stderr;
  return `kolu: ${typeof e?.message === "string" ? e.message : errorMessage(error)}\n`;
}
