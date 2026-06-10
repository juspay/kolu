---
name: odu-mcp
description: odu MCP server launcher — drive CI from a coding agent. `bin/serve` resolves odu via Nix and runs `odu mcp` in the cwd. See the repo README for the tools/resources and override knobs.
user-invocable: false
---

# odu-mcp

The agent face of [odu](https://github.com/juspay/odu) — an MCP stdio server
that re-exposes a live CI run as agent tools (`run`, `get_nodes`, `tail_log`,
`rerun_node`, `wait_for_settle`) and subscribable resources (`odu://nodes`,
`odu://log/{node}`), so Claude Code / Codex / opencode / Gemini CLI drive CI
with structured calls instead of scraping terminal output.

`bin/serve` resolves odu through the consuming repo's own pinned flake output
(`nix run .#odu -- mcp`) and serves over stdio in that repo (dialing
`.ci/odu.sock`) — the exact, npins-pinned odu the repo's CI uses, never an
unpinned `github:` fetch. Override the flake-ref with `ODU_FLAKE`.

Full docs in the [repo README](https://github.com/juspay/odu/blob/master/README.md).

This skill primitive exists for APM's deployment convention — it lands
`bin/serve` at `.agents/skills/odu-mcp/bin/serve` in the consumer's working
tree (APM's skills-convergence path), which keeps the launcher available even
before `apm install` runs on a fresh clone. The package is mechanically a
"skill" in APM's primitive vocabulary; semantically it's a tool launcher.
