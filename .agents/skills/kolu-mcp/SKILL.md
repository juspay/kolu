---
name: kolu-mcp
description: kolu MCP server launcher — this host's terminals as agent tools. `bin/serve` resolves kolu via Nix and runs `kolu mcp` against the running padi. See packages/kolu-mcp/README.md for the expose map and denials.
user-invocable: false
---

# kolu-mcp

The agent face of [kolu](https://github.com/juspay/kolu) — an MCP stdio server
that re-exposes the running padi's terminals to a coding agent: the live roster
/ urgency / daemon-health **resources**, read tools (`screen_text` with tail
mode, `screen_history`, `git_getStatus`/`git_getDiff`,
`fs_listAll`/`fs_readFile`), the terminal-control **mutations**
(`lifecycle_create` / `lifecycle_kill` / `lifecycle_sendInput` with the
named-key vocabulary — text and Enter as SEPARATE sends), and the two composite
done-signals `wait_outputSettled` / `wait_agentState` that the **`/kolu`
skill's driving protocol** (create → send → settle → submit → settle) consumes —
this skill is the SERVER launcher; `/kolu` is the protocol that drives through
it. Default-deny: daemon admin, session policy, and canvas
arrangement are named non-entries. `bin/serve` resolves kolu through Nix — the
checkout's own flake by default (dogfood serves the code you're sitting in;
`KOLU_FLAKE` overrides, e.g. `github:juspay/kolu` for a pinned release) — so no
`kolu` on PATH is assumed.
