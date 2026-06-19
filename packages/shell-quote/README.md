# @kolu/shell-quote

**POSIX shell-quoting for a single argv token** — wrap a value so a shell
re-parsing the result reproduces _exactly_ the token it was built from, with no
word-splitting and no metacharacter interpretation. One frozen concept, pinned
to the POSIX shell grammar, so this primitive has a change-cadence of ~zero.

It lives in its own **zero-dependency leaf package** — modeled on
[`@kolu/html-escape`](../html-escape) — so app-agnostic appliances across an
otherwise-incompatible dependency tree can reach it without depending on each
other. Today that is [`anyagent`](../integrations/anyagent) (re-emitting a
normalized recent-agent command line for a shell to run) and
[`kaval-tui`](../kaval-tui) (printing copy-pasteable `… --host X` / `… --socket P`
attach hints): both depend on this leaf, neither depends on the other, and the
quoting concept exists exactly once with one shared test suite.

## API

```ts
import { shellJoin, shellQuoteArg, shellSplit } from "@kolu/shell-quote";
```

### `shellQuoteArg(token: string): string`

Quote one token. A safe bare word — only chars that carry no shell meaning
(`A-Z a-z 0-9 @ % _ + = : , . / ~ -`) — is returned unquoted so the common case
stays clean; everything else (whitespace, quotes, `$`, backticks, `;`, `&`,
braces, …, and the empty string) is wrapped in single quotes, with any embedded
single quote escaped the canonical `'\''` way.

```ts
shellQuoteArg("sonnet");        // → sonnet
shellQuoteArg("/tmp/my sock");  // → '/tmp/my sock'
shellQuoteArg(`{"x": 1}`);      // → '{"x": 1}'
shellQuoteArg("it's");          // → 'it'\''s'
```

### `shellJoin(argv: readonly string[]): string`

`argv.map(shellQuoteArg).join(" ")` — join tokens into one command line that a
shell re-parses back into the same argv, so no value silently splits in two.

```ts
shellJoin(["claude", "--settings", `{"ultracode": true}`]);
// → claude --settings '{"ultracode": true}'
```

**Command-head precondition.** The replay equivalence is for the _argument
tail_, the values after an ordinary command word. It assumes `argv[0]` is a
plain command name, which is what every consumer here passes (an agent
basename: `claude`, `codex`, …). A shell resolves the **command-position** word
by grammar _before_ quote-removal, so a token that survives in argument
position can still change meaning as `argv[0]`: `shellQuoteArg` leaves
`FOO=bar` and `if` bare (both are safe bare words), but the shell reads a
leading `FOO=bar` as a variable assignment and a leading `if` as a reserved
word, not as a command to run. Quote the head yourself, or keep it a plain
command name, if you cannot guarantee it is one.

### `shellSplit(line: string): string[]`

The **exact inverse of `shellJoin`** — `shellSplit(shellJoin(argv))` deep-equals
`argv`. Use it to reparse your _own_ joined output. It is deliberately **not** a
general shell tokenizer: it understands only the two forms `shellQuoteArg`
emits — bare words and single-quoted runs, including the `'\''` idiom — and does
_not_ implement double quotes, `$` expansion, operators, or globs. For raw user
input, reach for a real parser such as
[`string-argv`](https://www.npmjs.com/package/string-argv) instead.

```ts
shellSplit(`claude --settings '{"ultracode": true}'`);
// → ["claude", "--settings", `{"ultracode": true}`]
shellSplit(`'don'\''t'`); // → ["don't"]   (a general tokenizer shatters this)
```

**Target shell.** The replay guarantee — `shellJoin`'s output re-parsing back to
the same argv — likewise assumes a **POSIX-compatible** shell on the receiving
end: `sh`, `bash`, `zsh`, and `dash` share the single-quote and tilde semantics
it relies on. Shells with different quoting rules (`fish`, `csh`) are out of
scope, so exact replay isn't guaranteed there. A real-shell round-trip test
([`index.test.ts`](./src/index.test.ts)) pins this against whatever POSIX shell
the dev/CI environment provides, and skips cleanly where none is available.

## Tilde handling

A leading `~` is treated as a safe bare word and left **unquoted**, so a shell
re-expands `~/path` to the same home directory the source used — the preexec mark
that feeds `anyagent` captures a command's source _before_ expansion, and the
round-trip's job is to reproduce that source. A source that _quoted_ the tilde to
mean a literal `~` is indistinguishable once a tokenizer has stripped the quotes,
so it too replays as an expanding `~`: a rare case intentionally not preserved
([#1407](https://github.com/juspay/kolu/pull/1407)).
