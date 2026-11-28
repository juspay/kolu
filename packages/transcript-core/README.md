# kolu-transcript-core

The vendor-neutral transcript model. An agent integration parses its own
session files into this shape; a renderer reads this shape and never looks at
a vendor's wire format. One entry: `.` (`src/index.ts`).

## What it exports

- `TranscriptSchema`, `TranscriptEventSchema`, `ToolInputSchema`,
  `TranscriptPrSchema` and their types. The Effect schemas that define the
  model: a session's header fields, its event stream, and the typed tool-call
  union (`edit`, `write`, `patch`, `read`, `bash`, `glob`, `grep`, and so on,
  falling through to `unknown`).
- `Fetcher`, `FetcherInput`. The contract every integration's loader
  implements: it takes session id, title, repo, cwd, model, token count and
  pull request context, and returns a `Transcript` or `null`.
- `TRANSCRIPT_HTML_MODES`, `TranscriptHtmlMode`, `MODE_LABEL`. The two export
  modes (`chat`, `full`) and the words used for them on screen.
- `relativizeTranscript`, `makeRelativizer`, `transformStrings`,
  `StringTransform`. Structural rewrites over a typed transcript, used to turn
  absolute paths inside the cwd into `./relative` form.
- `contentToText`, `parseIsoTimestamp`. Readers shared by the agents whose
  JSONL carries the same envelope.

## Who uses it

The agent integrations `agents`, `claude-code`, `codex`, `grok`, `omp`, `pi`,
`opencode`, `xyne` and `antigravity`; `kolu-transcript-html`; `padi` and `padi-client`. It
depends on `@kolu/log` and `effect` only.

## What not to break

- The model names no agent. `agentName` is a display string a loader fills in,
  so adding an agent never edits a schema here.
- The tool union discriminates on `kind`, not Effect's `_tag`. The field name
  and every literal value are the contract with loaders and renderers.
- A loader returns `null` for a transcript that is not written yet, and throws
  only for a corrupt or incompatible source.
- `TRANSCRIPT_HTML_MODES` is the one list of modes. The RPC schema in
  `kolu-common` derives from it and the renderer imports the type, so adding a
  mode is one edit that breaks the build at each consumer.
- `makeRelativizer` rewrites only paths strictly under the cwd. Leaving
  out-of-cwd absolutes alone is what keeps `/proj` from matching `/proj-other`.

`src/schemas.test.ts`, `src/transform.test.ts` and `src/content.test.ts` hold
the behavioural contract.
