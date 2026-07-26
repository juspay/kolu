---
name: odu-mcp
description: odu MCP server launcher — drive CI from a coding agent. `bin/serve` resolves odu via Nix and runs `odu mcp` in the cwd. See the repo README for the tools/resources and override knobs.
user-invocable: false
---

# odu-mcp

The agent face of [odu](https://github.com/juspay/odu) — an MCP stdio server
that re-exposes a live CI run as agent tools (`run`, `node_rerun`,
`wait_for_settle`, `cancel`, `lease`, `release`) and subscribable resources
(`surface://streams/nodes`, `surface://collections/logs/{id}`), so Claude Code /
Codex / opencode / Gemini CLI drive CI with structured calls instead of
scraping terminal output.

`lease` / `release` are the agent-held venue layer: hold a free box across
discrete tool calls without re-queuing between `run`s. `lease` returns
immediately (`held` or `waiting`); re-call or inventory to observe the line.
`run` reuses held hosts and does not release them on exit.

`wait_for_settle` defaults to fail-fast: it returns the instant the first node
goes red (`fail_fast_tripped: true`, `settled: false`), so the agent drills into
the failure without blocking on the slow lanes — its `failed[]` is only what's
red so far, and only `passed: true` (a fully settled run) is a trustworthy green.
A verdict about an observed run is stamped with that run's identity — `sha7`
always, `seq` whenever the coordinator reserved an ordinal — so it's clear
*which* run it describes (`seq` is `null` only when none was reserved: a wait
that saw no frame, or the rare case the coordinator couldn't reserve one);
and `unposted[]` carries full owed GitHub status rows
(`{context, lastError, attempts}`) not yet confirmed (reporting debt never
blocks settle — the test verdict stays the truth).
Called with **no run live**
it fails loud (an error mirroring `odu status`, not an empty `settled: false`),
and an optional `expected_sha` (prefix-matched against the run's `sha7`) refuses
loud when the live run's commit doesn't match. If the coordinator's socket
closes before it publishes a terminal frame, the verdict comes from the run's
finalized record on disk — never green for a run torn down mid-flight. The
`nodes` resource carries the same `unposted`. MCP `run` tees coordinator
stdout/stderr to `.ci/<sha7>/runs/<seq>.log`.

`cancel` stops the live run and waits until it's torn down; `run`'s `supersede`
cancels a run already live here before starting (the "stop this, run the fixed
commit" move), `linger` keeps the coordinator serving past settle so a node can
be rerun afterwards, and `no_wait` fails immediately when every host in a venue
pool is busy (default: wait in line). Together they let the agent loop call off
or replace a run instead of stranding it or hitting "a run is already in
progress".

`bin/serve` is self-contained — it resolves odu via `nix run` and serves over
stdio in the consumer's repo (dialing `.ci/odu.sock`). Set `ODU_FLAKE` to
override the odu flake-ref (default `github:juspay/odu`); a repo that
re-exports odu can point it at its own pinned output with `ODU_FLAKE=.#odu`.

Full docs in the [repo README](https://github.com/juspay/odu/blob/master/README.md).

This skill primitive exists for APM's deployment convention — it lands
`bin/serve` at `.agents/skills/odu-mcp/bin/serve` in the consumer's working
tree (APM's skills-convergence path), which keeps the launcher available even
before `apm install` runs on a fresh clone. The package is mechanically a
"skill" in APM's primitive vocabulary; semantically it's a tool launcher.
