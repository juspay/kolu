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

/** POSIX-quote one argv token for safe re-execution by a shell.
 *
 *  A token that is already a safe bare word — only the chars that carry no
 *  shell meaning (`/^[A-Za-z0-9@%_+=:,./-]+$/`) — is returned unquoted so the
 *  common case (`claude --model sonnet`, `nix@prod`, `/run/…/pty-host.sock`)
 *  stays clean. Everything else (whitespace, glob, `$`, backtick, quotes, `;`,
 *  `&`, newline, …) and the empty string is wrapped in single quotes, with any
 *  embedded single quote escaped the canonical `'\''` way. */
export function shellQuoteArg(token: string): string {
  if (token !== "" && /^[A-Za-z0-9@%_+=:,./-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, "'\\''")}'`;
}

/** Join argv tokens into a single shell-parseable command line, re-quoting
 *  each token so a shell re-parsing the result reproduces exactly the tokens
 *  it was built from (no value silently splits into two args). */
export function shellJoin(argv: readonly string[]): string {
  return argv.map(shellQuoteArg).join(" ");
}
