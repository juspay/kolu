# kolu-claude-code — what kolu knows about Claude Code

One leaf per agent, and this is Claude's. Everything kolu knows that is true of Claude Code and of nothing else lives here; [`kolu-agents`](../agents) is the one registry that folds the leaves together, and `anyagent` is the agent-agnostic kernel that names no agent at all. A package that imported this one directly would have re-braided exactly the per-agent knowledge that split buys — `packages/tests/governance/agentDepFence.test.ts` refuses it.

## Three doors

| entry | what it is |
|---|---|
| `.` | the agent's `AgentVocab` + `AgentPlugin`: display name, brand mark, CLI grammar, resume policy, detection adapter, transcript fetcher, env keys — how kolu RECOGNISES a Claude in a PTY and reads what it did |
| `./schemas` | the value schemas that vocabulary is declared in, as a pure-`effect` leaf a browser can import |
| `./acp` | the **ACP engine** — how kolu TALKS to Claude over the Agent Client Protocol |

The third door shares no graph with the first two: it is read by [`@kolu/acp-harness`](../../acp-harness) through the registry, and nothing it reaches touches the transcript machinery `.` is made of. The note in `package.json` says so — and lives OUTSIDE the `exports` map, because a key there that does not start with `.` is read by Node as a *condition*, and mixing conditions with subpaths makes it refuse the whole map.

## The `./acp` entry

`ENGINE` is a `Registering` (`@kolu/acp/engine`): the name a person reads, the `Leg` that reads this adapter's wire, `at(where)` — which seats it on a host or hands back the whole sentence a host without it is owed — and the channel its standing prompt rides (`first-turn`, because ACP has no system prompt).

`at` reads **`KOLU_ACP_AGENT`** and never consults the search path: the adapter is BAKED into kolu's closure (`nix/packages/acp-adapter.nix`) with `--set-default`, so an absence is a build that lost it, not a tool somebody has not installed yet — and an explicitly exported value (a developer's own build, the e2e harness's fixture adapter) wins over the bake.

The `Leg` is the interesting half — what this adapter's frames MEAN. Everything hangs off `_meta.claudeCode`: `toolName`, `parentToolUseId`, the `subagent` gate, `backgroundTask` (the patched adapter's `{taskId, description, status, report}`), and the `session/list` stamps. The CLI's own `system`/`init` message rides over on `rawMessages`, asked for in the open's `_meta` and carrying the two things ACP has no place for: the model a turn is really running on, and what the agent says about its connection to each MCP server kolu handed it.

Two policies worth stating out loud:

- **`bypassPermissions` is requested on every new AND loaded session, and a refusal is non-fatal** (`bypassModeRequired` false) — reported, then the conversation continues on whatever the agent chose.
- **`allowedWithoutAsking` approves only a tool positively recognised** as belonging to an MCP server kolu handed over, selecting an option whose `kind` starts with `allow` — never "the first option", which on this adapter is sometimes the plan-mode exit.

`provisionalTitle` is this adapter's own shape: it announces a tool call the moment the model starts emitting arguments, so the first title is a placeholder (`rawInput: {}`, a Bash call arriving as the bare word "Terminal"). A provisional title is SHOWN — a nameless row while the arguments stream is worse — but it does not ANSWER what the row is called.

`REMOTE_SIGNALS` names the variables the spawn must NOT see (`NO_BROWSER`, `SSH_*`, `CLAUDE_CODE_REMOTE`): the adapter ORs them into an `isRemote` reading and then offers only a full-screen `claude /login`. kolu *is* the remote end and owns the sign-in, so those are stripped and the paste-a-code methods survive.

## The pin

`acp/shim/` is the npm shim the adapter derivation builds from, and `acp/patches/` holds the two patches applied to the compiled bundle with `patch -p1 -F0` — see that directory's README for what each buys and why a version bump must FAIL rather than quietly drop one.
