/**
 * Pure logic for the `send` subcommand — turn the text/keys a caller passes into
 * the exact byte writes that reach the PTY, with no I/O or transport so it is
 * unit-testable without a socket. `main.ts` is the thin glue that resolves the
 * id, reads the text (positional / `--file` / stdin), issues `terminal.write`
 * for each planned chunk, and prints; `sendExec.ts` drives the plan to the wire
 * under a bounded write deadline.
 *
 * `send` writes EXACTLY what the caller asked for — the literal text, OR any
 * explicit `--key`s — and nothing more. It NEVER appends a submit Enter on its
 * own, and it never bakes in a timing grace: a prompt is submitted only when the
 * caller says so, as its own separate `kaval-tui send <id> --key Enter`.
 *
 * Why submit is its own command, not a flag. Against a bracketed-paste TUI
 * (Claude Code), the input box debounces a paste before accepting an Enter. An
 * Enter written in the SAME breath as the text — `send <id> "text" --key Enter`,
 * or the deleted `--submit=<ms>` grace — races that debounce: `kaval` cannot
 * observe when the TUI settled, so any fixed delay is a knob you tune until the
 * race stops biting on your machine and starts again on a slower one. The honest
 * design (the tmux `send-keys` model — strictly compositional, no submit
 * convenience) is a three-step flow where the CALLER observes the settle (the
 * command lines are single-sourced in {@link SUBMIT_FLOW_HELP}):
 *
 *     kaval-tui send <id> --file brief.md     # 1. the text
 *     kaval-tui wait <id> --until idle:300     # 2. OBSERVE the TUI settle (a signal, not a sleep)
 *     kaval-tui send <id> --key Enter          # 3. submit
 *
 * So text + `--key` in ONE send is a HARD ERROR (see {@link resolveSendInput}):
 * the dropped-Enter trap is made unspellable, not merely warned about.
 *
 * The one transformation `send` applies is BRACKETED PASTE for multiline text,
 * piped stdin, or a `--file` payload: the agent's input box takes it as ONE
 * block instead of submitting line-by-line (each `\n` would otherwise fire a
 * half-written prompt). It is auto — on for multiline / stream text, off for a
 * single-line argument — and `--paste` / `--no-paste` force it; the `paste`
 * field of the result makes it visible, never silent.
 */
import {
  controlByte,
  metaByte,
  NAMED_KEY_BYTES,
  wrapBracketedPaste,
} from "@kolu/terminal-protocol";

/** The named keys `send` accepts, as one human string for the command help, the
 *  `--key` flag help, and the unknown-key error — so the vocabulary is written
 *  ONCE, not hand-copied across three doc strings (the drift class `keyInput.ts`
 *  was created to kill). Slashes group the arrow cluster; `send.test.ts` guards
 *  that every token here resolves via `encodeKey` and that every byte in
 *  `NAMED_KEY_BYTES` is reachable from it, so adding a key to the table without
 *  listing it here fails CI — the same protection pulam's `WAIT_STATES` enjoys. */
export const ACCEPTED_KEY_NAMES =
  "Enter, Escape, Tab, Up/Down/Left/Right, Home, End, Backspace, Space, Shift-Tab";

/** A named key (`Escape`, `Up`, `Enter`, case-insensitive) or a modifier chord
 *  (`C-c`, `M-b`) → its raw bytes; `undefined` when unrecognized. The named-key
 *  table and the `C-` control fold come from `@kolu/terminal-protocol`, so this
 *  CLI shares the one byte vocabulary with the rich client and the mobile key
 *  bar; only the CLI-only `C-`/`M-` chord parsing lives here. `M-<char>`
 *  (meta/alt) prefixes ESC to the char verbatim (`M-b` → `\x1bb`). */
export function encodeKey(name: string): string | undefined {
  const named = NAMED_KEY_BYTES[name.toLowerCase()];
  if (named !== undefined) return named;
  // Bind the captured char directly so it narrows to `string` (the regex has one
  // group, but `noUncheckedIndexedAccess` types `match[1]` as `string | undefined`).
  const ctrl = /^c-(.)$/i.exec(name)?.[1];
  if (ctrl !== undefined) return controlByte(ctrl);
  const meta = /^m-(.)$/i.exec(name)?.[1];
  if (meta !== undefined) return metaByte(meta);
  return undefined;
}

/** The canonical three-step submit ritual, rendered ONCE so the command lines
 *  can't drift across the sites that teach it: the `--submit` migration error
 *  ({@link rejectUnknownSendFlags}), the text+key error ({@link resolveSendInput}),
 *  and this module's docstring. Only the load-bearing command lines are
 *  single-sourced here — each site keeps its own framing sentence. */
export const SUBMIT_FLOW_HELP =
  "  kaval-tui send <id> --file brief.md      # 1. the text\n" +
  "  kaval-tui wait <id> --until idle:300     # 2. observe the TUI settle\n" +
  "  kaval-tui send <id> --key Enter          # 3. submit";

/** Reject unknown flags on `send` — its flag set is a KNOWN, closed set, so an
 *  unrecognized flag is a typo or a removed flag, never something to silently
 *  ignore. Pure (takes the parsed unknown-flag names, throws a loud error), so
 *  it's unit-testable without argv. Fail-fast, no-silent-fallback doctrine: a
 *  `send <id> "hi" --submit` that quietly sends WITHOUT submitting is exactly the
 *  footgun this PR removes, so `--submit` (just deleted) gets a migration message
 *  pointing at the two-command pattern; any other unknown flag fails generically.
 *  `main.ts` passes `Object.keys(argv.unknownFlags)`. */
export function rejectUnknownSendFlags(
  unknownFlagNames: readonly string[],
): void {
  if (unknownFlagNames.length === 0) return;
  if (unknownFlagNames.includes("submit")) {
    throw new Error(
      "--submit was removed — submitting a prompt is now its OWN command, because a same-breath Enter races the TUI's paste debounce and is silently dropped. Send the text, watch the TUI settle, then submit separately:\n" +
        SUBMIT_FLOW_HELP,
    );
  }
  const names = unknownFlagNames.map((f) => `--${f}`).join(", ");
  throw new Error(
    `unknown flag${unknownFlagNames.length > 1 ? "s" : ""} for send: ${names}. send accepts text (positional) or --file <path>, plus --key, --paste / --no-paste, --json, and --socket / --host.`,
  );
}

/** The resolved, validated text source for a send — a discriminated descriptor
 *  that carries its own payload locus, so a `file` send hands back the path
 *  WITH the tag and `cmdSend` never has to re-associate a bare enum with a
 *  separately-passed path (no untyped invariant, no cast). `none` is a keys-only
 *  send. Produced once by {@link resolveSendInput}. */
export type SendInput =
  | { kind: "positional" }
  | { kind: "file"; path: string }
  | { kind: "stdin" }
  | { kind: "none" };

/** Did the resolved source arrive as a BLOCK from a stream — `--file` or piped
 *  stdin — so it auto-pastes even when single-line? An EXHAUSTIVE switch over
 *  `input.kind` with no default (matching `readSendText`'s reader), so adding a
 *  {@link SendInput} variant is compiler-forced to declare its stream-ness rather
 *  than silently defaulting to the line-by-line path. */
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

/** The human name of a resolved text source — an EXHAUSTIVE switch over
 *  `input.kind` (no default, matching {@link sourceIsStream}), so it is the ONE
 *  home for how each source is named in a user-facing message and a new
 *  {@link SendInput} variant is compiler-forced to name itself rather than
 *  defaulting to a wrong label. Consumed by BOTH the two-sources conflict error
 *  ({@link resolveSendInput}) and the empty-source error (`cmdSend`), so the
 *  vocabulary is written once. The `--file` label carries its path so both sites
 *  name the exact file. */
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
 *  into a {@link SendInput} descriptor — PURE, so the entire arg-legality matrix
 *  is unit-tested without a socket, a filesystem, or a tty. This is the ONE home
 *  for "what flag combinations are illegal for `send`": `main.ts` runs it pre-dial
 *  (a bad combination fails before any connection is made) and then reads the
 *  payload from the returned descriptor. Throws a loud, teaching error on any
 *  illegal combination; the message surfaces as `kaval-tui: <msg>`.
 *
 *  The rules, all fail-fast (no silent precedence to guess at):
 *  - `--paste` and `--no-paste` are mutually exclusive (the both-set combination
 *    is expressible but illegal — crash loud rather than silently pick one).
 *  - AT MOST ONE text source. Positional text, `--file`, and a piped-stdin
 *    payload each fully specify the text; two at once is ambiguous, so it is
 *    rejected rather than silently letting one win.
 *  - TEXT + `--key` is forbidden outright — the dropped-Enter trap (a same-breath
 *    Enter raced by the paste debounce) is made unspellable. Keys-only sends
 *    (menus, `C-c`, a lone `--key Enter` submit) stay legal.
 *  - A send with no text and no keys has nothing to do — rejected.
 *
 *  `stdinIsPayload` is whether fd 0 is a DELIBERATE pipe (a `fifo` from `| cmd`
 *  or a `regular file` from `< file` / a heredoc), NOT merely "not a tty": an
 *  agent driving `send` from a subprocess has a `socket` on stdin, which is
 *  ambient, not a payload — so it must not read as a stdin send nor collide with
 *  `--file`. `main.ts` computes it by `fstat`-ing fd 0. */
export function resolveSendInput(opts: {
  hasPositional: boolean;
  /** The `--file` path, or `undefined` when the flag is absent — carried into
   *  the returned descriptor so the path travels WITH the source tag. */
  file: string | undefined;
  stdinIsPayload: boolean;
  hasKeys: boolean;
  paste: boolean;
  noPaste: boolean;
}): SendInput {
  if (opts.paste && opts.noPaste) {
    throw new Error(
      "--paste and --no-paste are mutually exclusive — pass at most one (omit both for auto).",
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
    throw new Error(
      `${present.map(sourceLabel).join(" and ")} each provide the send text — pass exactly one source, not several.`,
    );
  }
  const input: SendInput = present[0] ?? { kind: "none" };

  if (input.kind !== "none" && opts.hasKeys) {
    throw new Error(
      "text and --key can't be combined in one send — a same-breath Enter is raced by the TUI's paste debounce and silently dropped. Send the text, watch the TUI settle, then submit as its own command:\n" +
        SUBMIT_FLOW_HELP,
    );
  }

  if (input.kind === "none" && !opts.hasKeys) {
    throw new Error(
      'nothing to send — pass text, use --file <path>, pipe it on stdin, or use --key (e.g. `kaval-tui send <id> "hello"` or `kaval-tui send <id> --key Escape`).',
    );
  }

  return input;
}

/** The ordered byte writes a `send` issues, plus what it actually did (for the
 *  human/JSON line). `paste` is the EFFECTIVE value — text-gated and
 *  paste-auto-resolved — not the raw flag. */
export interface SendPlan {
  /** The single `terminal.write` payload this send issues — EITHER the (optionally
   *  bracketed) text OR the encoded keys, never both. The text-XOR-keys invariant
   *  is a TYPE here, not a comment: {@link planSend} takes a discriminated content
   *  input, so the `[text, keys]` pair is unspellable rather than merely
   *  convention. */
  write: string;
  /** Total UTF-8 bytes of the write (paste markers included) — the honest
   *  CR/byte total for `--json`. */
  bytes: number;
  paste: boolean;
}

/** The content a send carries — EITHER text (optionally a stream block, with the
 *  paste tristate) OR encoded keys, never both. A discriminated union so the
 *  forbidden text+keys pair is unspellable at the plan boundary; the caller picks
 *  the arm from the already-resolved {@link SendInput}, not by re-sniffing text. */
export type SendContent =
  | {
      kind: "text";
      text: string;
      paste: boolean | undefined;
      /** The text arrived as a BLOCK from a stream — piped stdin or `--file` —
       *  not as a literal single-line argument, so it auto-pastes even when
       *  single-line (a file/heredoc is one payload, not a line typed at a
       *  prompt). */
      fromStream: boolean;
    }
  | { kind: "keys"; keyData: string };

/** Plan the single write for a send. Pure and TOTAL over its legal input: a
 *  discriminated {@link SendContent} makes text+keys unspellable, so there is no
 *  precedence branch to guess at. For the text arm, paste is resolved here (auto
 *  unless `paste` is set) and the text is bracketed accordingly; the keys arm
 *  writes the encoded bytes verbatim (never pasted). No submit Enter is ever
 *  synthesized — the caller submits with an explicit, separate `--key Enter`. */
export function planSend(content: SendContent): SendPlan {
  if (content.kind === "keys") {
    return {
      write: content.keyData,
      bytes: Buffer.byteLength(content.keyData, "utf8"),
      paste: false,
    };
  }

  // A zero-length text arm is a no-op write — reject it rather than plan a
  // 0-byte send, so a direct caller can't mint a no-op plan (the empty positional
  // / empty --file / empty pipe that `cmdSend` catches with a source-named error
  // first). Fail-fast: a silent 0-byte "success" would mask the upstream failure
  // that produced the empty payload.
  if (content.text.length === 0) {
    throw new Error(
      "planSend: refusing an empty text send — a 0-byte write is a no-op, not a submit.",
    );
  }

  // Auto-paste: a single-line argument types literally, but multiline OR a
  // stream payload (--file / piped stdin) is bracketed so it lands as one block.
  // An explicit flag overrides.
  const paste =
    content.paste ?? (content.fromStream || content.text.includes("\n"));

  const write = paste ? wrapBracketedPaste(content.text) : content.text;

  return { write, bytes: Buffer.byteLength(write, "utf8"), paste };
}
