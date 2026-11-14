# kolu-agents

The agent **registry** — the ONE place kolu lists its agents. It folds every
`kolu-<agent>` package's `AgentVocab` (browser-safe facts) and `AgentPlugin`
(adapter + fetcher + env keys) into the closed `AgentKind`/`AgentInfo` wire
vocabulary, the kind-keyed CLI registry, and the flattened env-key list.

It is the registry **plug board** that `anyagent` (the kernel, which names no
agent) deliberately is not. `anyagent` owns the contracts and the algorithms;
each agent package owns that agent's data; this package owns the list — and is
the **only** package (besides `packages/tests`) allowed to depend on a
`kolu-<agent>` package. That fence is enforced by
`packages/tests/governance/agentDepFence.test.ts`.

## Modules

| Module      | Exports                                                                                                                                                  | Purpose                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `vocab.ts`  | `AGENT_VOCABS`, `AgentKind`, `AgentInfoOf`, `AgentKindSchema`, `AgentInfoSchema`, `AgentInfo`, `AgentPresenceSchema` / `AgentPresence` / `agentPresence` / `isAgentPresence` / `SessionAgentInfo` (an agent present before its session exists — `starting` / `fresh` / `prompted` — as one kind-agnostic member of the `AgentInfo` union), `agentVocab`, `agentCliGrammar`, `mapAgentVocabs`, `isAgentKind`, `isAgentBinaryName`, `resumeRefFor`, `AGENT_CLI`, the registry-bound CLI functions (`resumeFormFor`, `resumableCommand`, `agentLaunchLine`) — plus `anyagent`'s `agentNameHint` / `stableFlagTokens` re-exported | Browser-safe vocabulary + the resume/launch renderer, pre-bound to the registry. |
| `index.ts`  | `AGENT_PLUGINS`, `AGENT_DIR_ENV_KEYS`, `agentDiagnostics`                                                                                                | Node plugin record (adapters · fetchers · env keys) and its folds. |

## Adding an agent

1. Create `packages/integrations/<agent>/` exporting `<agent>Vocab` (in its
   browser-safe `./schemas`) and `<agent>Plugin` (in its root) — every facet the
   `AgentVocab`/`AgentPlugin` interfaces require, so a missing one is a compile
   error **in that package**.
2. Add one import and one row to `vocab.ts`'s `AGENT_VOCABS` and `index.ts`'s
   `AGENT_PLUGINS`.
3. Add the package to `nix/workspace.nix`, then `pnpm install` and
   `just emit-consumer-closure`.

Everything else — the kind enum, the info union, CLI grammar, resume policy,
icons, pip glyph, display names, env keys, transcript dispatch, sensor
registration — is derived. See the "Adding an agent" section of
`website/src/content/docs/agent-detection.mdx`.

## Saying something to an agent (`AgentVocab.say`)

Every vocab declares **how to hand that agent words through its TUI** — the
keys to press after the text, per state, and what pressing them does to a turn
that is already running. kolu-mcp's `agent_say` reads it, so no driver ever
needs per-agent key knowledge again (a human having to tell a conductor that
"omp needs a second Enter" is the bug this deletes; the real fix is the SETTLE
between the paste and the Enter, which `agent_say` performs).

Each recipe carries `verified` — how it is known to be true. Measured by
**running the agent in a kolu terminal on 2026-11-13**, except grok, which is
not installed here and is taken from xAI's own keyboard reference.

| Agent | Idle | Working | What working delivery does | Verified |
| --- | --- | --- | --- | --- |
| claude-code | `Enter` | `Enter` | **queue** — the running turn finishes first, then the message starts a new one | ran `claude` 2.1.322 |
| codex | `Enter` | `Enter` | **steer** — the words join the turn that is running | ran `codex-cli` 0.167.1 |
| opencode | `Enter` | `Enter` | **queue** — the generation completes, then it answers the message | ran `opencode` 2.2.7 |
| grok | `Enter` | `Enter` | **queue** — "the turn picks up the prompt at its next tool or model step" (its send-now chord CANCELS the turn, so it is deliberately not the recipe) | [docs.x.ai/build/keyboard-shortcuts](https://docs.x.ai/build/keyboard-shortcuts) |
| pi | `Enter` | `Enter` | **steer** — the line enters pi's steering pane and the turn takes it at its next step | ran `pi` 1.5.2 |
| omp | `Enter` | `Enter` | **steer** — "Steering · 1", consumed mid-turn (the running answer changed) | ran `omp` 18.18.8 |
| xyne | `Enter` | `Enter` | **steer** — the pi-derived "Steering:" pane | ran `xyne-cli` 0.4.8-dev |

`working: null` is the honest answer for an agent whose TUI drops input
mid-turn; `say: null` for one kolu cannot talk to at all. Both are REFUSALS at
the tool, naming the agent — never a guessed keystroke landing in someone's
half-finished work.

## Design

- **Derived, not hand-maintained.** `AgentKind`/`AgentInfoSchema` come from
  `Object.values(AGENT_VOCABS)`; a hand-copied kind list would be a second
  closed set for one vocabulary.
- **Crash loudly at load.** `buildCliRegistry` throws on a duplicate kind — the
  compile fence the old `BASENAME_TO_KIND` record had becomes a load-time fence.
- **No basename-keyed PARSER, and no command-string reader.** The registry
  resolves by KIND. The one basename predicate — `isAgentBinaryName` — answers
  "could this head token name an agent that may be launching?", the sensor's
  shim hint; nothing derives anything else from a basename. A command line kolu
  types is rendered from `{ kind, argv }` facts (`resumeFormFor`,
  `agentLaunchLine`) through the same registry.
- **The registry is browser-safe where it can be.** `vocab.ts` imports only
  `kolu-<agent>/schemas` + `anyagent` + `effect`; the node half is `index.ts`.
