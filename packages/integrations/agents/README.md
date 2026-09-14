# kolu-agents

The agent **registry** — the ONE place kolu lists its agents. It folds every
`kolu-<agent>` package's `AgentVocab` (browser-safe facts) and `AgentPlugin`
(adapter + fetcher + env keys) into the closed `AgentKind`/`AgentInfo` wire
vocabulary, the basename-keyed CLI registry, and the flattened env-key list.

It is the registry **plug board** that `anyagent` (the kernel, which names no
agent) deliberately is not. `anyagent` owns the contracts and the algorithms;
each agent package owns that agent's data; this package owns the list — and is
the **only** package (besides `packages/tests`) allowed to depend on a
`kolu-<agent>` package. That fence is enforced by
`packages/tests/governance/agentDepFence.test.ts`.

## Modules

| Module      | Exports                                                                                                                                                  | Purpose                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `vocab.ts`  | `AGENT_VOCABS`, `AgentKind`, `AgentInfoOf`, `AgentKindSchema`, `AgentInfoSchema`, `AgentInfo`, `DETECT_ONLY_AGENTS`, `agentVocab`, `isAgentKind`, `resumeRefFor`, `AGENT_CLI`, the registry-bound CLI functions (`parseAgentCommand`, `resumeAgentCommand`, `resumeFormFor`, `resumableCommand`, `agentKindFromCommand`, `exactRestoreTarget`) | Browser-safe vocabulary + CLI/resume, pre-bound to the registry. |
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

## Design

- **Derived, not hand-maintained.** `AgentKind`/`AgentInfoSchema` come from
  `Object.values(AGENT_VOCABS)`; a hand-copied kind list would be a second
  closed set for one vocabulary.
- **Crash loudly at load.** `buildCliRegistry` throws on a duplicate kind or
  basename — the compile fence the old `BASENAME_TO_KIND` record had becomes a
  load-time fence.
- **The registry is browser-safe where it can be.** `vocab.ts` imports only
  `kolu-<agent>/schemas` + `anyagent` + `effect`; the node half is `index.ts`.
