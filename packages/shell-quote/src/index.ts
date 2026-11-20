const SHELL_INERT_CHARS = "A-Za-z0-9@%_+=:,./-";
const TILDE_LEFT_BARE_FOR_EXPANSION = "~";
const SAFE_BARE_WORD = new RegExp(
  `^[${TILDE_LEFT_BARE_FOR_EXPANSION}${SHELL_INERT_CHARS}]+$`,
);

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
  let token: string | null = null;
  const push = (s: string) => {
    token = (token ?? "") + s;
  };
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === " " || c === "\t" || c === "\n") {
      if (token !== null) {
        argv.push(token);
        token = null;
      }
      continue;
    }
    if (c === "'") {
      const close = line.indexOf("'", i + 1);
      if (close === -1) {
        throw new Error(
          "shellSplit: unterminated single quote — not shellJoin output",
        );
      }
      push(line.slice(i + 1, close));
      i = close;
      continue;
    }
    if (c === "\\") {
      const next = line.charAt(i + 1);
      if (next !== "") {
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
