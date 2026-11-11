# @kolu/acp — the protocol's words, owned by the wall that speaks them

The [Agent Client Protocol](https://agentclientprotocol.com)'s vocabulary as kolu spells it, and the pure projections between ACP's own payloads and that vocabulary. **The package that speaks the foreign thing owns its words**: this package declares the ask vocabulary, and the packages that carry it on a wire (`@kolu/padi-client`'s orchestrator members) import it from here rather than re-declaring it.

## The modules

| file | what it owns |
|---|---|
| `wire.ts` | the vocabulary that travels kolu's wire: `AskChoice` / `AskField` / `AskAnswer` / `AskOutcome`, the `YES_NO` spelling both ends must agree on, `FileDiff` and `Usage`. On its own `./wire` subpath — the half a surface declaration re-exports, with no protocol payload in sight |
| `asks.ts` | the protocol's two ways of asking a PERSON something (`elicitation/create` form mode, `session/request_permission`), projected into one drawable form — and the answers projected back, typed the way the schema asked |
| `diffs.ts` | the protocol's `diff` content blocks, read as data: which file a call rewrote, what was there, what is there now |
| `usage.ts` | the protocol's `usage_update`, read as data: how full the conversation's context is, and how big the window is. Here rather than in one of the engines' legs because it is ACP's own update kind — any agent may send one — and the cost it also carries is deliberately not read |
| `terminal.ts` | the protocol's terminal-output `_meta` readings |
| `activity.ts` | the AIR v1 extension channel: native child sessions and async tasks, negotiated and validated, bridging the pinned SDK's closed update union |
| `leg.ts` + `engine.ts` | what one AGENT means by what it sends, and what it takes to seat one on a host: the `Leg` interface (a `_meta` one adapter writes, a tool-naming convention one CLI uses, a permission mode one has and another refuses), the `Adapter` to spawn, the `Where` a probe is given, the sentence for a machine that has none, and the channel a standing prompt rides. On its own `./engine` subpath — see below |

Everything is a pure function over a payload. Nothing here waits, spawns, or knows a subprocess exists — the subprocess that speaks these words is `@kolu/acp-harness`'s, and stays there.

## The seam, and the manifest

This is a LEAF that speaks ACP and nothing of kolu: no `@kolu/*` import. A payload this vocabulary cannot say comes back as this package's own one word, `Refused`, and `@kolu/acp-harness` translates it at the seam it consumes this from, once.

What may cross the boundary is machine-checked rather than agreed by comment: `src/manifest.test.ts` enumerates the package's imports (only `effect` and the SDK's types), its closed export list, where the SDK may be imported at all, and who may open which of the three doors.

## This vocabulary is SHARED, and shared means append-only

kolu is not the only reader of this package. [olai](https://github.com/juspay/olai) vendors it as raw TypeScript through its `nix/consumer.nix`, and olai's chat plugin reads parts of it kolu's own orchestrator never touches — `nativeActivity`, `terminalMetaIn`, `Steering`, `Leg.steering`, `Leg.queues`. So **`@kolu/acp` is kept a SUPERSET of olai master's `packages/acp`**: kolu may add, kolu may not take away.

That makes "ported surface with no consumer, delete it" — the right rule everywhere else in this tree, and the rule `@kolu/acp-harness` follows — **wrong here**, and it has already been got wrong once: three modules and five `Leg` members went out as dead code, and nothing in this repository went red, because nothing in this repository called them. A type-level contract whose consumer is in another repository has no compiler watching it.

So it has a test instead. `src/sharedVocabulary.json` records every exported name and every `readonly` member; `src/sharedVocabulary.test.ts` asserts each is still there. It is a **floor, not a fence**: adding is free and silent, removing or renaming fails. Two consequences worth stating:

- **A new REQUIRED member is a removal in disguise** — it breaks every leg written before it existed. Declare it optional and read an absent one as the honest nothing (`ModelReading.windowIn`).
- **A genuine removal is a two-repository change.** Land it in olai first, then drop the ledger row here with that PR named in the commit. Editing the ledger to make a red test green is the one move this file exists to stop.

## Why an ENGINE'S shape lives here

`./engine` is the shared contract between one agent's integration package (`@kolu/claude-code`'s `./acp` entry) and the harness that seats it. `Registering.at(where)` returns an `Adapter` or `NotHere`, never an unexplained null. This package owns both data shapes and is the only door onto them: an engine with multiple prerequisites supplies the reason for the one that is missing.

This package is where it belongs on merit rather than by elimination: an engine is *an ACP agent and how to reach one*, and the protocol is the language rather than an integration. A `Leg` is a reading of one speaker's spelling of that language, which is the same kind of thing `asks.ts` and `diffs.ts` are one degree less specifically.

What is deliberately NOT on that door: the standing prompt's TEXT (one module in the host that composes it — kolu's is `packages/padi/src/orchestrator/teaching.ts`, because the words name that host's own MCP verbs; only the CHANNEL is the engine's), and the SPAWN, which is `@kolu/acp-harness`'s because that is the package that speaks the protocol out loud.
