# ref-surface-cli

- Kind: reference. Reader: someone wiring `@kolu/surface-cli` who needs to look up an export, a flag spelling or an exit code.
- Rewritten from: `f50641c6a`
- Words (counted by `docs-lint`'s rules): 3,787 → 3,706.
- Frontmatter: unchanged (`title`, `description`, `order`, `section`).

## Shape

- Three `##` export groups, each opening with an index table (`Export | Subpath | What it is`, one line per row), then one `###` per export: "Building the command tree" (`surfaceCommands(opts)`, `surfaceHelp(opts)`, `READER_NAMES`, `SurfaceCliBuildError`), "Flags and input" (`flagsOf(schema, opts?)`, `JSON_FLAG` · `INPUT_FLAG`), "The run edge" (`EXIT`, `reportingRunEdge`, `runEdge(error)`, `isConsumerHangup(failure)`, `SurfaceCliFailure`, the types row, and `RootedSurfaceClients` · `SurfaceCliConnection`).
- Behaviour groups kept as `##`: "How a surface member becomes a command" (the old "The projection"), "Output discipline", "Exit codes", and the two-gates section.
- New entries for exports the old page documented only in the "Other exports" table or in prose: `surfaceHelp(opts)`, `READER_NAMES`, `SurfaceCliBuildError`, `flagsOf(schema, opts?)`, `JSON_FLAG` · `INPUT_FLAG`, `reportingRunEdge`, `runEdge(error)`, `isConsumerHangup(failure)`, `SurfaceCliFailure`, `RootedSurfaceClients` · `SurfaceCliConnection`.
- Long cells became entries or fact lists: the six `surfaceCommands` option cells, the two `endpoint` field cells, the exit `3` cell, and every cell of the old "Other exports" table.
- Two asides became one. "Where the endpoint flags live is YOUR decision" is now the `#### Where the endpoint flags live` section; the local-validation aside stays (1 aside on the page).
- Bold run-ins became headings: "A field that can be CLEARED takes the value, or the word" → `#### Clearing a nullable field`; "Names are not transformed." → `#### Flag names`; `reportingRunEdge` and `runEdge(error)` became entries.

## Headings renamed

| Old | New |
| --- | --- |
| `## surfaceCommands` | `## Building the command tree` (+ `### surfaceCommands(opts)`) |
| `### A rooted bundle, with the sibling key as the first argv word` | `#### The sibling key is the first argv word` |
| `### The endpoint seam` | `#### The endpoint seam` (same text, now inside the entry) |
| `## The projection` | `## How a surface member becomes a command` |
| `## flagsOf — how an input becomes flags` | `## Flags and input` (+ `### flagsOf(schema, opts?)`) |
| `## Other exports` | `## The run edge` |
| `## Two gates, as with MCP` | `## What the CLI offers and what the server answers` |

- `## Exit codes` and `## Output discipline` keep their text verbatim.
- Only inbound link to a renamed heading was the same-page `#two-gates-as-with-mcp` (in the `reportingRunEdge` passage); it now points at `#what-the-cli-offers-and-what-the-server-answers`. No other file links into this page's headings (`.waterfall/anchors.md`).
- Outbound links into `ref-surface` anchors are unchanged, as the task directs.

## Moved

| Fact | Where |
| --- | --- |
| "A shell has a real hierarchy, so using it beats gluing the key on with an underscore…" plus "one composition, spelled once per face…" | `why-surfaces` → "Why each face spells a name its own way" |
| "That is a subtraction at build rather than a refusal at run time… a flag whose help is untrue" | `reactive-honesty` → `## A face offers only what it can do` |
| "The split is the point…" and "Reporting that on the code that means 'the verb did what it was asked' would make 'I could not find out' indistinguishable from success" | `reactive-honesty` → `### The same split on the command line` (under `## An empty stream fails loud, never quiet`) |
| "a separate `describe(values)` beside a `connect(values)` is two readings of one decision with nothing holding them together" (full passage; a one-clause version stays in the entry, keeping both code spans) | `reactive-honesty` → `## A face offers only what it can do`, second paragraph |

## Cut

| Fact | Tag |
| --- | --- |
| "It was spelled `--json` and was renamed, because that name is now the **answer's**" (the fact that `--json` is the answer's flag and `--input` the input's stays) | history |
| "so it used to fall to the JSON flag, and a plain line of text wanted `--desc '"the brass ones"'` on the four or five verbs a person types most" (the span stays, as what a wider union still spells) | history |
| "It used to be the descriptor — prose to a terminal, data through a pipe — so one command answered with two different things depending on what it happened to be attached to, and neither could be asked for on purpose." (the rule, that `--json` alone decides, stays) | history |
| "Those two lines are one recipe, and the combinator exists because the three moves inside it are safety-critical and were being hand-written per binary." | history |
| "so a verb cannot mean one thing to an agent and another to a terminal" moved from the opening to the projection table, where the flat name is | duplicate (same page) |
| "a face that published the framework's rules under its own name would be a second place to look for them" | rationale (the rule "one concept, one import path" stays) |
| Emphasis capitals: `TOP`, `BUNDLE ROOT`, `BUILD`, `RUNS`, `SPACING`, `ANSWER`, `INPUT`, `THUNK`-style forms, `CLEARED`, `ENUM`, `DESCRIPTION`, `BOTH`, `OWNS`, `REQUIRED`, `YOUR` | rewritten in lower case |

## Dropped code spans

None (`node .waterfall/compare.mjs website/src/content/surface/ref-surface-cli.mdx`: 0 missing).
