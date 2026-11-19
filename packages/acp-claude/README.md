# @kolu/acp-claude — the Claude Code agent, as one package

Everything both products know about the Claude Code agent, behind one door: the
leg that reads its ACP wire, what its model picker calls things, the variables
its CLI reads as "this person is somewhere else", where it keeps its signature
on a host, the name a person reads, and the **pinned adapter itself** — its npm
shim, the two patches over it, and the Nix facts that build it.

kolu runs this agent in its conductor. [olai](https://github.com/juspay/olai)
runs the same adapter and vendors this directory as raw TypeScript, so the two
products cannot disagree about which adapter is pinned or what its wire means.

## The modules

| file | what it owns |
|---|---|
| `src/leg.ts` | what THIS adapter means by what it sends — kolu's instance of `@kolu/acp/engine`'s `Leg`: the `claudeCode` `_meta` corner, the `mcp__<server>__<tool>` naming, the permission mode it offers and refuses, background tasks, task-notifications, steering and queueing, and what a `session/list` row carries beyond the protocol |
| `src/models.ts` | the model table: which `configOptions` entry names the model, what the picker calls each id, and each model's context window |
| `src/env.ts` | `REMOTE_SIGNALS` (the five variables the adapter reads as "remote", which the host must strip) and `configDirIn` (where the CLI keeps its signature) |
| `src/name.ts` | `NAME` — "Claude Code", which is a name rather than a word with a capital letter |
| `adapter/default.nix` | the facts both products must agree about the pin: `shim`, `shimName`, `package`, `entry`, `bin`, `version`, `npmDepsHash`, `patches` |
| `adapter/shim/` | the npm shim: `package.json` and the lockfile that pin the adapter |
| `adapter/patches/` | the two patches, applied to the compiled adapter at `-F0` — read `./adapter/patches/README.md` before touching either |
| `adapter/session-list-info/` | the generator and tests for the second patch — the pairing rules live in `facts.js`, and the patch is that script's print-out |

## What a maintainer must not break

- **The leg is a SUPERSET.** olai's panel reads two things kolu's conductor does
  not: `listedIn` (the patched `session/list` stamps) and `terminalOutput` (a
  Bash result as a terminal block). kolu may add to this package; kolu may not
  take away — there is no compiler in another repository to notice. What olai
  imports by name is recorded in `src/sharedVocabulary.json` and held by
  `src/sharedVocabulary.test.ts`; the leg's own members are recorded where
  `Leg` is declared, in `@kolu/acp`.
- **The adapter build must keep failing loudly.** Both patches are applied at
  `patch -p1 -F0` over a COMPILED bundle: a pin bump that moves the context has
  to break the build rather than fuzz a hunk into the wrong place. A `patches`
  directory with no `.patch` in it fails the eval, not silently builds green.
- **The shim is kolu's own lockfile.** Its `name` and `overrides` (zod's 4.6.7
  over the adapter's 4.6.5 pin) are part of the npm cache key, which is why
  `npmDepsHash` is kolu's value and not olai's, for the same pinned adapter.

## Not here

A session, a prompt, a transcript, and the sentence a machine without this
engine is owed. [`@kolu/acp-client`](../acp-client) speaks the protocol out
loud and [`@kolu/acp-harness`](../acp-harness) holds the conversation; the
not-found sentence names kolu's padi — a fact about kolu's product, so it lives
in kolu's agent registry (`kolu-agents`' `src/acp.ts`, which also seats this
engine).
