# kolu-claude-code — what kolu knows about Claude Code

One leaf per agent, and this is Claude's. Everything kolu knows that is true of Claude Code and of nothing else lives here; [`kolu-agents`](../agents) is the one registry that folds the leaves together, and `anyagent` is the agent-agnostic kernel that names no agent at all. A package that imported this one directly would have re-braided exactly the per-agent knowledge that split buys — `packages/tests/governance/agentDepFence.test.ts` refuses it.

## Two doors

| entry | what it is |
|---|---|
| `.` | the agent's `AgentVocab` + `AgentPlugin`: display name, brand mark, CLI grammar, resume policy, detection adapter, transcript fetcher, env keys — how kolu RECOGNISES a Claude in a PTY and reads what it did |
| `./schemas` | the value schemas that vocabulary is declared in, as a pure-`effect` leaf a browser can import |

## The ACP half is a package of its own

How kolu TALKS to Claude over the Agent Client Protocol — the `Leg` that reads this adapter's wire, the model table, the pinned adapter (its npm shim, its two patches, the Nix facts that build it) — moved to [`@kolu/acp-claude`](../../acp-claude), and that package's README is where all of it is argued.

The move is not tidying: **olai runs the same adapter**, and each product carried its own copy of the leg, the shim and the patches. A fact about which adapter is pinned is a fact about the agent, so it lives beside the agent — in a package both products vendor — rather than in either product's integration.

What stays here is what a HOST's process needs: `kolu-agents`' `src/acp.ts` seats the engine (`KOLU_ACP_AGENT`, which five variables the spawn must not see, and the sentence a machine without the adapter is owed), reading `NAME`, `CLAUDE`, `REMOTE_SIGNALS` and `configDirIn` from `@kolu/acp-claude`. Nothing in this package imports the protocol any more.
