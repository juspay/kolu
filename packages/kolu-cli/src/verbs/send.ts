/**
 * `kolu send` — type into a terminal.
 *
 * This is the raw WRITE half of driving a program (a prompt to an agent), and
 * it graduated here from `kaval-tui send` unchanged in behavior: same flag
 * matrix, same errors, same bytes on the wire. Only the transport moved — the
 * old face wrote through kaval's `terminal.write`, this one writes through
 * padi's `lifecycle.sendInput`, which is the only daemon a kolu face speaks to.
 *
 * ## `--submit` delivers; a bare send writes
 *
 * Without `--submit`, `send` issues the literal text OR the explicit `--key`s
 * and nothing more: no Enter is appended, no timing grace is baked in, and a
 * prompt is submitted only when the caller says so, as its own separate
 * `kolu send <id> --key Enter`.
 *
 * `--submit` is the whole dispatch instead — and it is emphatically NOT the
 * `--submit` this file once said would never come back. That one was a fixed
 * delay: against a bracketed-paste TUI (Claude Code, Codex) the input box
 * debounces a paste before it will accept an Enter, and a caller cannot see when
 * the TUI settled, so any baked-in sleep is a knob you tune until the race stops
 * biting on your machine and starts again on a slower one. What changed is not
 * the sleep — it is WHO WATCHES. `--submit` hands the whole delivery to padi
 * (`lifecycle.submitInput`), which sees kaval's output edge for every PTY and
 * folds every terminal's agent state, so it can wait for the prompt to be idle,
 * type, wait for the TUI to take it, and press Enter — all on SIGNALS, none on a
 * clock:
 *
 *     kolu send <id> --submit --file brief.md   # the whole dispatch, one command
 *
 * The compositional form is still here, still correct, and is what you reach for
 * when something must happen BETWEEN the text and the Enter (the command lines
 * are single-sourced in {@link SUBMIT_FLOW_HELP}):
 *
 *     kolu send <id> --file brief.md      # 1. the text
 *     kolu wait <id> --until idle:300     # 2. OBSERVE the TUI settle (a signal, not a sleep)
 *     kolu send <id> --key Enter          # 3. submit
 *
 * So text + `--key` in ONE send is still a HARD ERROR ({@link resolveSendInput}):
 * the dropped-Enter trap is made unspellable, and `--submit` is the safe way to
 * fuse them precisely because padi does the observing the caller cannot.
 *
 * **What `--submit` does when the target is busy.** It REFUSES, having typed
 * nothing, rather than queueing — several TUIs clear a typed-but-unsubmitted
 * input box when their turn ends, so "type now, Enter later" loses the message
 * outright. Exit non-zero, and the diagnostic says whether anything landed. The
 * doctrine lives in `@kolu/padi`'s `submitInput.ts`.
 *
 * ## The one transformation: bracketed paste
 *
 * Multiline text, a `--file` payload, or piped stdin is wrapped in bracketed
 * paste so the agent's input box takes it as ONE block instead of firing a
 * half-written prompt at every `\n`. It is AUTO — on for multiline / stream
 * text, off for a single-line argument — and `--paste` / `--no-paste` force it.
 * The effective value is reported (`· pasted`, and the `paste` field of
 * `--json`), so the wrapping is never silent.
 *
 * ## What changed in the move, and why
 *
 * kaval-tui carried a `--paste` + `--no-paste` pair of booleans and a hand-written
 * "these two are mutually exclusive" check, because its parser let both be set at
 * once. Effect CLI's `Flag.boolean(...).pipe(Flag.optional)` IS the tristate —
 * `--paste` is `some(true)`, `--no-paste` is `some(false)`, absent is `none` — so
 * the contradiction is no longer expressible and the check that refused it has
 * nothing left to refuse. The rule did not weaken; it moved into the type.
 *
 * The planning half (source resolution, the legality matrix, the paste fold) is
 * pure and lives here as exported functions with no I/O, no transport and no
 * tty, so the whole matrix is testable without a socket. `run` is the thin glue:
 * resolve the id prefix, read the one live text source, plan, write, report.
 */

import { fstatSync, readFileSync } from "node:fs";
import { text as readStdinText } from "node:stream/consumers";
import { shortId } from "@kolu/padi/render";
import { hasTag, SubmitRefused } from "@kolu/padi/surface";
import {
  type SendContent,
  encodeSend,
  type SendPlan,
  sendShapeRefusal,
  type SendVocabulary,
} from "@kolu/terminal-protocol";
import { Effect } from "effect";
import type { Command } from "effect/unstable/cli";
// `import type` — fully erased, so this does NOT re-enter the command tree at
// runtime and the per-face dynamic-import fence is untouched.
import type { sendFlags } from "../cli.ts";
import { type Endpoint, withPadi } from "../endpoint.ts";
import { blankFlag, type CliFailure, failure, isBlank } from "../exit.ts";
import { resolveTerminal, writeErr, writeJson } from "./shared.ts";

/** What the command tree parsed for `send` — DERIVED from `sendFlags` in
 *  `cli.ts`. `text` is the variadic positional the shell already split; `key` is
 *  repeatable; `file` and `paste` are optional, projected to `undefined` at the
 *  flag rather than re-narrowed here. */
export type SendArgs = Command.Command.Config.Infer<typeof sendFlags>;

/** The canonical three-step submit ritual, rendered ONCE so the command lines
 *  can't drift across the sites that teach it — this module's docstring and the
 *  text+key error ({@link resolveSendInput}). Each site keeps its own framing
 *  sentence; only the load-bearing command lines are shared. */
export const SUBMIT_FLOW_HELP =
  "  kolu send <id> --file brief.md      # 1. the text\n" +
  "  kolu wait <id> --until idle:300     # 2. observe the TUI settle\n" +
  "  kolu send <id> --key Enter          # 3. submit";

// ── stdout / stderr ──────────────────────────────────────────────────────────
//
// Both channels come from `./shared.ts`. stdout is the DATA channel, and for
// `send` the only datum is the `--json` frame: it is written through a draining
// sink so a piped stdout has actually flushed before the verb returns and the
// process tears down (a truncated last line is the classic one-shot-CLI bug),
// and a write error is reported as a failure rather than collapsed into silence
// — with the single exception of `EPIPE`, which means the consumer hung up
// (`kolu send … --json | head -1`) and is a normal end, not a fault. stderr
// carries the trailer, never the scriptable payload.

// ── The text source ──────────────────────────────────────────────────────────

/** The resolved, validated text source for a send — a discriminated descriptor
 *  that carries its own payload locus, so a `file` send hands back the path WITH
 *  the tag and the reader never has to re-associate a bare enum with a
 *  separately-passed path (no untyped invariant, no cast). `none` is a keys-only
 *  send. Produced once by {@link resolveSendInput}. */
export type SendInput =
  | { readonly kind: "positional" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "stdin" }
  | { readonly kind: "none" };

/** Did the resolved source arrive as a BLOCK from a stream — `--file` or piped
 *  stdin — so it auto-pastes even when single-line? An EXHAUSTIVE switch with no
 *  default (matching {@link readSendText}), so adding a {@link SendInput} variant
 *  is compiler-forced to declare its stream-ness rather than silently defaulting
 *  to the line-by-line path. */
export function sourceIsStream(input: SendInput): boolean {
  switch (input.kind) {
    case "file":
    case "stdin":
      return true;
    case "positional":
    case "none":
      return false;
  }
}

/** The human name of a resolved text source — the ONE home for how each source
 *  is named in a user-facing message, consumed by BOTH the two-sources conflict
 *  error ({@link resolveSendInput}) and the shared policy's empty-payload refusal
 *  (rule 4, which quotes this label rather than knowing argv's source model), so
 *  the vocabulary is written once. Exhaustive, so a new variant must name itself
 *  rather than defaulting to a wrong label. The `--file` label carries its path
 *  so both sites name the exact file. */
export function sourceLabel(input: SendInput): string {
  switch (input.kind) {
    case "positional":
      return "positional text";
    case "file":
      return `--file ${JSON.stringify(input.path)}`;
    case "stdin":
      return "piped stdin";
    case "none":
      return "no text source";
  }
}

/** Validate a send's WHOLE input combination and resolve the single text source
 *  into a {@link SendInput} descriptor. Pure — it builds an Effect, it performs
 *  no I/O — so the entire legality matrix is unit-testable without a socket, a
 *  filesystem or a tty, and `run` evaluates it BEFORE dialing, so a bad
 *  combination fails without touching a padi.
 *
 *  The rules, all fail-fast (no silent precedence to guess at):
 *  - A `--file` with a BLANK value is refused by name — an unset shell variable,
 *    not a file to go looking for.
 *  - AT MOST ONE text source. Positional text, `--file`, and a piped-stdin
 *    payload each fully specify the text; two at once is ambiguous, so it is
 *    rejected rather than silently letting one win.
 *  - TEXT + `--key` is forbidden outright — the dropped-Enter trap (a
 *    same-breath Enter raced by the paste debounce) is made unspellable.
 *    Keys-only sends (menus, `C-c`, a lone `--key Enter` submit) stay legal.
 *  - A send with no text and no keys has nothing to do — rejected.
 *
 *  `--paste` / `--no-paste` need no rule here: the parser's optional boolean is
 *  already the tristate, so "both at once" cannot be spelled (see the module
 *  header).
 *
 *  `stdinIsPayload` is whether fd 0 is a DELIBERATE pipe, NOT merely "not a
 *  tty" — see {@link stdinIsPayload}. */
export function resolveSendInput(opts: {
  readonly hasPositional: boolean;
  /** The `--file` path, or `undefined` when the flag is absent — carried into
   *  the returned descriptor so the path travels WITH the source tag. */
  readonly file: string | undefined;
  readonly stdinIsPayload: boolean;
  readonly hasKeys: boolean;
  /** `--submit` — the whole-delivery form. Legal only with a text source. */
  readonly submit: boolean;
  /** `--settle-ms` / `--submit-timeout` — the submit's two waits, and both
   *  meaningless without it. */
  readonly settleMs: number | undefined;
  readonly submitTimeout: number | undefined;
}): Effect.Effect<SendInput, CliFailure> {
  // A `--file` the user SPELLED but left empty is the same shell accident
  // `endpointOf` refuses for `--socket` and `create` refuses for its placement
  // flags (`--file "$BRIEF"` with `$BRIEF` unset), and it shares their
  // `isBlank` rule. It would otherwise reach `readFileSync("")` and come back as
  // `--file "": no such file`, which sends the reader looking for a file rather
  // than for the variable that did not expand.
  if (opts.file !== undefined && isBlank(opts.file)) {
    return Effect.fail(
      blankFlag("--file", "the file to read the send text from"),
    );
  }

  // The text sources present, as descriptors, in precedence order. Enumerated
  // ONCE: the two-sources error names them via `sourceLabel`, and the resolved
  // source is just the first (or `none`). `opts.file !== undefined` narrows to
  // `string`, so the `file` descriptor carries its path with no cast.
  const present: SendInput[] = [];
  if (opts.hasPositional) present.push({ kind: "positional" });
  if (opts.file !== undefined) present.push({ kind: "file", path: opts.file });
  if (opts.stdinIsPayload) present.push({ kind: "stdin" });
  if (present.length > 1) {
    return Effect.fail(
      failure(
        `${present.map(sourceLabel).join(" and ")} each provide the send text — pass exactly one source, not several.`,
      ),
    );
  }
  const input: SendInput = present[0] ?? { kind: "none" };

  // Rule 1 is the shared policy's, decided from the SHAPE — before the source is
  // read, so a `--file` this send would refuse anyway is never opened.
  const illegal = sendShapeRefusal(
    { hasText: input.kind !== "none", hasKeys: opts.hasKeys },
    SEND_VOCABULARY,
  );
  if (illegal !== undefined) return Effect.fail(failure(illegal));

  if (input.kind === "none" && !opts.hasKeys) {
    return Effect.fail(
      failure(
        'nothing to send — pass text, use --file <path>, pipe it on stdin, or use --key (e.g. `kolu send <id> "hello"` or `kolu send <id> --key Escape`).',
      ),
    );
  }

  // The `--submit` gates. Every one is "a flag you spelled would have been
  // ignored", which this verb refuses rather than silently honours (the same
  // rule `--repo` without `--worktree` obeys one verb over). They live here, in
  // the ONE combination gate, rather than beside the write: a bad combination
  // must fail without touching a padi, and `--settle-ms` on a `--key` send would
  // otherwise be discovered only by its absence of effect.
  if (opts.submit && input.kind === "none") {
    return Effect.fail(
      failure(
        "--submit has nothing to submit — it delivers TEXT (type it, watch the TUI take it, press Enter). To press a key on its own, drop --submit; to submit what is already typed, use --key Enter.",
      ),
    );
  }
  // One table, so the two knobs cannot drift into two spellings of one rule.
  for (const [flag, value, what] of [
    ["--settle-ms", opts.settleMs, "quiet window"],
    ["--submit-timeout", opts.submitTimeout, "give-up bound"],
  ] as const satisfies ReadonlyArray<
    readonly [string, number | undefined, string]
  >) {
    if (value !== undefined && !opts.submit) {
      return Effect.fail(
        failure(
          `${flag} is --submit's ${what} and this send does not submit — add --submit, or drop ${flag}.`,
        ),
      );
    }
  }

  return Effect.succeed(input);
}

/** Is fd 0 a DELIBERATE stdin payload — a `fifo` (`| cmd`) or a `regular file`
 *  (`< file` / a heredoc)? A bare `!isTTY` is too broad: an agent driving `kolu
 *  send` from a subprocess inherits a `socket` on stdin (and `/dev/null` is a
 *  char device), neither of which is a payload the user piped in. Distinguishing
 *  them by `fstat` keeps `--file` usable in exactly that agent context (stdin
 *  isn't a competing source) while still catching a real `< file` collision. A
 *  closed or unstattable fd 0 is "no payload" — the ABSENCE of readable stdin is
 *  a fact, not a swallowed error. */
export function stdinIsPayload(): boolean {
  try {
    const st = fstatSync(0);
    return st.isFIFO() || st.isFile();
  } catch {
    return false;
  }
}

/** Decode a stream payload — a `--file` read or a drained stdin — as UTF-8. Both
 *  stream sources go through the SAME decoder so `kolu send <id> --file brief.md`
 *  and `kolu send <id> < brief.md` put identical bytes on the wire; they are the
 *  same payload by every other rule here (both auto-paste as one block), so they
 *  must not disagree about their first character.
 *
 *  That character is the reason this exists: `TextDecoder` STRIPS a leading UTF-8
 *  BOM, `Buffer.toString("utf8")` keeps it. Stripping is the right call for a
 *  send — the BOM is an encoding preamble, not content, and forwarded verbatim it
 *  lands in the agent's input box as an invisible zero-width character ahead of
 *  the prompt, where it can silently defeat a leading `/command` match. The rest
 *  of the payload is still byte-exact: no shell in the loop, so backticks and
 *  `$( )` reach the wire untouched. */
const decodeUtf8 = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes);

/** Read the send TEXT from the resolved, pre-validated source.
 *  {@link resolveSendInput} has already rejected every illegal combination, so
 *  this just fetches from the one live source: the positional words re-joined
 *  (the shell already split them), a `--file` payload, piped stdin, or nothing
 *  (a keys-only send). */
function readSendText(
  input: SendInput,
  textArgs: readonly string[],
): Effect.Effect<string, CliFailure> {
  switch (input.kind) {
    case "positional":
      return Effect.succeed(textArgs.join(" "));
    case "stdin":
      // Draining a stream to a string is `node:stream/consumers` — the one
      // genuinely foreign Promise on this path, so it is LIFTED rather than
      // composed, and hand-rolling the chunk loop only bought a second decoder.
      return Effect.tryPromise({
        try: () => readStdinText(process.stdin),
        catch: (err) =>
          failure(
            `could not read the send text from stdin: ${err instanceof Error ? err.message : String(err)}`,
          ),
      });
    case "file":
      // The path rides the descriptor (no cast). Decoded, not `readFileSync(…,
      // "utf8")`, so it agrees with the stdin arm about a leading BOM.
      return Effect.try({
        try: () => decodeUtf8(readFileSync(input.path)),
        catch: (err) => {
          const e = err as NodeJS.ErrnoException;
          return failure(
            `--file ${JSON.stringify(input.path)}: ${e.code === "ENOENT" ? "no such file" : e.message}`,
          );
        },
      });
    case "none":
      return Effect.succeed("");
  }
}

// ── The plan ─────────────────────────────────────────────────────────────────

/** `kolu send`'s spelling of the shared send policy — the flag it names in a
 *  refusal, and the ritual it quotes. Everything ELSE about what a send writes
 *  (text-XOR-keys, the unknown-key refusal, auto bracketed paste, the
 *  empty-payload refusal) is `@kolu/terminal-protocol`'s `sendPolicy`, because
 *  the MCP face enforces the same rules against the same padi member and a
 *  second copy is how the two faces come to answer the same intent differently
 *  — which is exactly what the empty payload did until it moved there. */
const SEND_VOCABULARY: SendVocabulary = {
  keyName: "--key",
  submitRitual: SUBMIT_FLOW_HELP,
};

/** Plan the single write, as an Effect over the CLI's failure channel — the
 *  shared encoder plus this face's error type. */
export function planSend(
  content: SendContent,
): Effect.Effect<SendPlan, CliFailure> {
  const encoded = encodeSend(content, SEND_VOCABULARY);
  return encoded.kind === "plan"
    ? Effect.succeed(encoded.plan)
    : Effect.fail(failure(encoded.message));
}

/** The one-line stderr trailer — a text send reads `sent 14 bytes to a1b2c3d4 ·
 *  pasted`, a keys-only send reads `sent 1 byte to a1b2c3d4 · keys: Enter`. The
 *  `· pasted` / `· keys: …` marks appear only when those happened, so the line
 *  never claims an action `send` didn't take; a send carries text OR keys, so
 *  the two marks never co-occur. */
export function formatSend(result: {
  readonly id: string;
  readonly bytes: number;
  readonly paste: boolean;
  readonly keys: readonly string[];
  /** Present only on a `--submit` send, and then always `true`: a submit that
   *  did not land failed instead of reporting. The two wait times ride with it
   *  because they answer different questions — how long the target was BUSY
   *  before it could be typed into, and how long the TUI took to swallow the
   *  paste. */
  readonly submitted?: {
    readonly readyAfterMs: number;
    readonly settledAfterMs: number;
  };
}): string {
  const base = `sent ${result.bytes} byte${result.bytes === 1 ? "" : "s"} to ${shortId(result.id)}`;
  const pasteMark = result.paste ? " · pasted" : "";
  const keysMark =
    result.keys.length > 0 ? ` · keys: ${result.keys.join(", ")}` : "";
  const submitMark =
    result.submitted === undefined
      ? ""
      : ` · submitted (waited ${result.submitted.readyAfterMs}ms for the prompt, ${result.submitted.settledAfterMs}ms for the settle)`;
  return `${base}${pasteMark}${keysMark}${submitMark}`;
}

// ── The write ────────────────────────────────────────────────────────────────

/** How long the write may take before `send` gives up and fails loud rather
 *  than hanging. FIXED in code, deliberately not a flag: a knob here would just
 *  be another thing to tune, and "never hang" shouldn't be defeatable. Long
 *  enough that any healthy write (a big paste to a draining TUI acks in well
 *  under a second) is untouched, short enough that a stalled terminal fails in
 *  seconds.
 *
 *  The deadline exists because a write can BLOCK indefinitely when the target
 *  isn't draining its input — a program that stopped reading stdin lets the
 *  PTY's input buffer fill and the write never acks. A one-shot CLI must not
 *  hang on that: unlike tmux, whose persistent server buffers the input
 *  asynchronously and returns at once, we have no server-side buffer to hand off
 *  to, so the fail-fast analog is to BOUND the write and exit loud. */
export const SEND_WRITE_DEADLINE_MS = 8_000;

/** Drive a {@link SendPlan} through an injected write sink under
 *  {@link SEND_WRITE_DEADLINE_MS}. The sink is injected so this stays
 *  transport-blind (and testable without a padi); `run` wires it to
 *  `lifecycle.sendInput`.
 *
 *  The whole "race one write against a deadline" dance — a `new Promise` whose
 *  `reject` fires from a `setTimeout`, a `Promise.race`, and a `.finally` to
 *  clear the timer — is one combinator. The timer cannot be leaked because there
 *  is no timer to leak, and the abandoned write is abandoned by interruption
 *  rather than left running with nobody attached to its rejection. */
export function executeSendPlan<E>(
  plan: SendPlan,
  write: (data: string) => Effect.Effect<void, E>,
  target: string,
): Effect.Effect<void, E | CliFailure> {
  return Effect.timeoutOrElse(write(plan.write), {
    duration: SEND_WRITE_DEADLINE_MS,
    orElse: () =>
      Effect.fail(
        failure(
          `write to terminal ${target} stalled — no acknowledgement within ${SEND_WRITE_DEADLINE_MS}ms. The terminal is not draining its input (a program that has stopped reading stdin?). Aborting rather than hanging.`,
        ),
      ),
  });
}

/** Retype padi's {@link SubmitRefused} as this face's own failure.
 *
 *  Without it a refusal reaches the run edge as a raw wire error, and the edge's
 *  contract is explicit about what that costs (`main.ts`, `exit.ts`): the
 *  one-line diagnostic is written from `reportOf`, and then — because the value
 *  carries no `Runtime.errorReported` marker — Effect's default teardown prints
 *  the whole pretty cause on top of it, stack frames from inside `effect`'s
 *  schema parser and all. The user is told twice, the second time in a form that
 *  reads like a crash in a message whose entire job is to be actionable. (Caught
 *  on a real box before this shipped; `kolu kill`'s not-found never showed it
 *  because that one is refused client-side and is already a `CliFailure`.)
 *
 *  The SENTENCE is padi's own — it already names the recovery, and rewriting it
 *  here is how the CLI and the MCP face would come to say different things about
 *  one refusal. This adds only what the edge needs: the exit code and the
 *  already-reported marker. Everything else propagates untouched, the same
 *  narrowness the MCP face's `asToolFailure` keeps. */
const asCliFailure = <A, E, R>(
  step: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | CliFailure, R> =>
  Effect.mapError(step, (error) =>
    hasTag(error, SUBMIT_REFUSED_TAG)
      ? failure((error as { message: string }).message)
      : error,
  );

/** {@link SubmitRefused}'s tag, read OFF the class rather than re-spelled — a
 *  rename moves this with it instead of silently un-matching. Matched
 *  STRUCTURALLY (padi's own `hasTag`), never with `instanceof`: the value was
 *  decoded from a wire frame in another realm, where class identity is not ours
 *  and `instanceof` quietly answers `false`. */
const SUBMIT_REFUSED_TAG: string = new SubmitRefused({
  id: "",
  phase: "ready",
  reason: "busy",
  waitedMs: 0,
})._tag;

// ── The verb ─────────────────────────────────────────────────────────────────

/** `kolu send <id> [text…]` — the glue: validate the combination BEFORE dialing,
 *  then dial, resolve the id prefix, read the one live source, plan, write, and
 *  report.
 *
 *  Every failure leaves on the ERROR channel as a `CliFailure`; nothing here
 *  calls `process.exit`, so the run edge owns the code (1 for a usage or link
 *  error) and the one-line diagnostic is written exactly once. */
export function run(
  endpoint: Endpoint,
  args: SendArgs,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    // Pre-dial: an illegal flag combination is decided without touching a padi.
    const input = yield* resolveSendInput({
      hasPositional: args.text.length > 0,
      file: args.file,
      stdinIsPayload: stdinIsPayload(),
      hasKeys: args.key.length > 0,
      submit: args.submit,
      settleMs: args.settleMs,
      submitTimeout: args.submitTimeout,
    });

    const text = yield* readSendText(input, args.text);

    // The resolved source already settled text-vs-keys (`none` is a keys-only
    // send; anything else is a text send, and the mix is forbidden), so the plan
    // arm is picked from it rather than by re-sniffing `text.length` — the single
    // source of truth for "text vs keys" stays in `resolveSendInput`. Planning
    // runs BEFORE the dial, so an unknown key name never costs a connection and
    // can never land as a half-send.
    //
    // A text source that reads back EMPTY (an empty --file, an empty pipe or
    // heredoc, or a literal `kolu send <id> ""`) is refused by the shared policy
    // (rule 4) rather than by a check here: it is decidable from the text alone,
    // and while it lived here the MCP face answered the identical intent with a
    // silent 0-byte success. This face still owns the WORDING of the source —
    // `sourceLabel` is handed to the encoder, which quotes it.
    const plan = yield* input.kind === "none"
      ? planSend({ kind: "keys", names: args.key })
      : planSend({
          kind: "text",
          text,
          sourceLabel: sourceLabel(input),
          paste: args.paste,
          fromStream: sourceIsStream(input),
        });

    yield* withPadi(endpoint, (conn) =>
      Effect.gen(function* () {
        const id = yield* resolveTerminal(conn, args.id);

        // `--submit` is ONE call on the far side, not this verb composing three:
        // the waits it performs are padi's, because padi is the process that can
        // see the terminal move. That also means no client-side write deadline
        // applies to it — `SEND_WRITE_DEADLINE_MS` bounds a write that may block
        // on a full PTY buffer, while a submit is bounded by its OWN readiness
        // timeout on the daemon side and would be cut off mid-delivery by a
        // second, shorter bound layered over it here.
        const submitted = args.submit
          ? yield* asCliFailure(
              conn.client.surface.lifecycle.submitInput({
                id,
                data: plan.write,
                ...(args.settleMs !== undefined
                  ? { settleMs: args.settleMs }
                  : {}),
                ...(args.submitTimeout !== undefined
                  ? { timeoutMs: args.submitTimeout }
                  : {}),
              }),
            )
          : yield* Effect.as(
              executeSendPlan(
                plan,
                (data) => conn.client.surface.lifecycle.sendInput({ id, data }),
                shortId(id),
              ),
              undefined,
            );

        const result = {
          id,
          bytes: plan.bytes,
          paste: plan.paste,
          keys: args.key,
          ...(submitted !== undefined
            ? {
                submitted: {
                  readyAfterMs: submitted.readyAfterMs,
                  settledAfterMs: submitted.settledAfterMs,
                },
              }
            : {}),
        };
        // The full id, so a script can key off it. The FRAME — pretty-printed,
        // newline-terminated, drained — is `./shared.ts`'s `writeJson`, shared
        // with the other --json arms; it used to be this literal plus a comment
        // saying "2-space indented like the other verbs' frames", which is a
        // comment doing a constant's job.
        if (args.json) return yield* writeJson(result, "the send result");
        // stdout stays EMPTY for a non-json send: there is no scriptable payload
        // here (`--json` is the machine path), so the status goes to stderr.
        yield* writeErr(`— ${formatSend(result)}\n`);
      }),
    );
  });
}
