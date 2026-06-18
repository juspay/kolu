/** POSIX shell-quoting for a single argv token — wrap a value so a shell
 *  re-parsing the result reproduces exactly the token it was built from, with
 *  no word-splitting and no metacharacter interpretation.
 *
 *  This is one frozen concept: "POSIX single-quote one argv token for safe
 *  shell re-execution." The quoting rule is a fixed external standard (the
 *  POSIX shell grammar), so this primitive has a change-cadence of effectively
 *  zero. It lives in its own zero-dependency leaf package — modeled on
 *  `@kolu/html-escape` — so app-agnostic appliances across an otherwise
 *  incompatible dependency tree can reach it without depending on each other:
 *  `anyagent` (re-emitting a normalized agent command line for a shell to run)
 *  and `kaval-tui` (printing copy-pasteable `… --host X` / `… --socket P`
 *  attach hints) both depend on this leaf, neither depends on the other, and
 *  the concept exists exactly once with one shared test suite. */

/** The safe bare-word charset: chars that carry no shell meaning, so a token
 *  built only from them needs no quoting to survive re-parsing.
 *
 *  `~` is deliberately included even though it IS shell-significant (leading
 *  `~` triggers tilde expansion). The preexec mark captures a command's shell
 *  SOURCE before expansion (e.g. the literal `~/.claude/settings.json` the
 *  user typed), so the round-trip's job is to reproduce that source — and a
 *  shell re-parsing a bare `~/…` re-expands it to the same home path the
 *  original run used. Single-quoting `~` would instead suppress that expansion
 *  and replay a literal `~` path, which is the wrong semantics for the path
 *  flags this is used on (`--settings ~/x`, `--add-dir ~/y`). Tilde is only an
 *  expansion at a word's start, so keeping it bare mid-word is inert.
 *
 *  Tilde is left bare unconditionally. A source that QUOTED the tilde
 *  (`--settings '~/x'`, meaning a literal `~` path) is indistinguishable at the
 *  token level — a tokenizer has already stripped the quotes — so it replays as
 *  an expanding `~` too. That quoted-literal-tilde case is rare and is
 *  intentionally not preserved (juspay/kolu#1407). */
const SAFE_BARE_WORD = /^[A-Za-z0-9@%_+=:,./~-]+$/;

/** Wrap a token in single quotes, escaping any embedded single quote the
 *  canonical `'\''` way — close the run, emit an escaped bare quote, reopen.
 *  Internal helper so the single quoting/escaping rule lives in exactly one
 *  place; `shellQuoteArg` routes its needs-quoting branch through it. */
function forceQuoteArg(token: string): string {
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** POSIX-quote one argv token for safe re-execution by a shell.
 *
 *  A token that is already a safe bare word (see `SAFE_BARE_WORD`) is returned
 *  unquoted so the common case (`claude --model sonnet`, `nix@prod`,
 *  `/run/…/pty-host.sock`, `~/.claude/settings.json`) stays clean. Everything
 *  else (whitespace, glob, `$`, backtick, quotes, `;`, `&`, newline, …) and the
 *  empty string is wrapped in single quotes (see `forceQuoteArg`). */
export function shellQuoteArg(token: string): string {
  if (token !== "" && SAFE_BARE_WORD.test(token)) return token;
  return forceQuoteArg(token);
}

/** Join argv tokens into a single shell-parseable command line, re-quoting
 *  each token so a shell re-parsing the result reproduces exactly the tokens
 *  it was built from (no value silently splits into two args). */
export function shellJoin(argv: readonly string[]): string {
  return argv.map(shellQuoteArg).join(" ");
}

/** Split a command line produced by `shellJoin` back into its argv — the exact
 *  inverse of `shellJoin`, so `shellSplit(shellJoin(argv))` deep-equals `argv`.
 *
 *  This is the parser `shellJoin`'s consumers MUST use when they reparse their
 *  own joined output. A general shell tokenizer (e.g. `string-argv`) is NOT a
 *  valid inverse: it does not understand the canonical embedded-single-quote
 *  idiom `'\''` that `shellQuoteArg` emits for a value like `don't`, and would
 *  shatter such a token into several. Because we only ever parse what we
 *  ourselves joined, this handles exactly the two forms `shellQuoteArg`
 *  produces — bare words and single-quoted runs (whitespace-separated) — and
 *  intentionally does NOT implement double quotes, backslash escaping, `$`
 *  expansion, etc.
 *
 *  POSIX single-quote semantics: inside `'…'` every byte is literal (no escape
 *  exists), so an embedded quote is written by closing the run, emitting an
 *  escaped bare quote (`\'`), and reopening (`'…'\''…'`). Adjacent quoted and
 *  bare runs with no separating whitespace concatenate into one token, which is
 *  exactly how that idiom (and `foo'bar baz'`) re-forms a single argument. */
export function shellSplit(line: string): string[] {
  const argv: string[] = [];
  let token: string | null = null; // null = between tokens; "" = an empty token
  const push = (s: string) => {
    token = (token ?? "") + s;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === undefined) break; // unreachable (i < length), but narrows the type
    if (c === " " || c === "\t" || c === "\n") {
      if (token !== null) {
        argv.push(token);
        token = null;
      }
      continue;
    }
    if (c === "'") {
      // Consume to the matching close quote; every byte inside is literal.
      const close = line.indexOf("'", i + 1);
      const end = close === -1 ? line.length : close;
      push(line.slice(i + 1, end));
      i = end; // loop's i++ steps past the close quote
      continue;
    }
    if (c === "\\") {
      // The only backslash `shellJoin` emits is the `\'` of the `'\''` idiom:
      // a single literal quote joining two single-quoted runs.
      const next = line[i + 1];
      if (next !== undefined) {
        push(next);
        i++;
      }
      continue;
    }
    push(c);
  }
  if (token !== null) argv.push(token);
  return argv;
}
