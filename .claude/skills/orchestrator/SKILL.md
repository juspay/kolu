---
name: orchestrator
description: >-
  Running memory of the coordination rules for an orchestrator agent driving
  implementing agents on kolu terminals — authorization boundaries, the
  kaval-tui dispatch protocol, verification discipline, and how to communicate
  with srid. Load whenever coordinating a multi-agent campaign (dispatching
  briefs to agents in kolu PTYs, tracking their PRs, verifying their claims),
  or when acting as the coordinator in a padi/surface-style campaign. Triggers
  on "orchestrate the agents", "coordinate the campaign", "dispatch to the
  agents", "act as coordinator", or driving multiple implementing agents from
  one supervising session.
---

# Orchestrator

Coordination rules for a supervising agent driving implementing agents on kolu
terminals. These are hard-won rules from real campaigns — follow them exactly;
each one exists because its violation caused damage.

## Authorization

- NEVER message another agent (`kaval-tui send` or otherwise) without srid's
  explicit permission for that specific dispatch. The one exception:
  overnight/autonomous runs srid has explicitly sanctioned.
- Use the AskUserQuestion tool whenever clarity from srid would help —
  ambiguous scope, a decision that forks the work, an unclear instruction —
  rather than guessing or proceeding on an assumption. Same exception:
  in an explicitly sanctioned overnight/autonomous run, where blocking on a
  question is not possible, proceed on documented best judgment instead.
- When srid asks a design/feasibility question ("can't we…?", "how should
  we…?"), the deliverable is an answer TO SRID — grounded in the actual code at
  the tree (read the files fresh; never from memory), with concrete API
  sketches and examples, judged by /perfection-review and
  /architecture-first-principles. Only after srid authorizes does anything go
  to an agent.
- srid merges ALL PRs. Never merge, never run CI without srid's explicit go
  when srid has said to hold, and keep PRs DRAFT.

## Dispatch protocol (kaval terminals)

- Two-step send: first
  `kaval-tui send <terminal-id> --socket <pty-host.sock> "<message>"`, then a
  SECOND command with `--key Enter` to submit. Never send C-c — it can kill
  in-flight work.
- No backticks or shell-expandable syntax in send payloads (bash
  command-substitutes them and mangles the message). Put large payloads in a
  file and send a short pointer message.
- Give every brief a unique report-back token (e.g. `W6COPY-N5T8`) so replies
  are attributable.
- Verify landing against the RECIPIENT's transcript: grep the token in the
  agent's `~/.claude/projects/<project-dir>/*.jsonl`. Never trust the send's
  exit code or a terminal snapshot — a snapshot recap is narrative, not state.

## Verification discipline

- Verify every agent claim at the tree/forge — `git fetch` and inspect the
  actual commits, `gh pr view` / `gh pr checks` — never from the agent's
  report alone.
- Reproduce-first for bugs. Never skip tests (no skip-with-tags workarounds).
  Never defer a defect that can be fixed now.
- Put watchdogs on long-running agents; tear down by captured PID/id. Agents
  must isolate shared-host state (e.g. `KOLU_REMOTE_PADI_STATE_DIR`) —
  production hosts and srid's default remote roots are untouchable.

## Communicating with srid

- Plain words, lead with the outcome. No cryptic codenames or arrow chains.
  srid should never have to ask twice for a TLDR.
- Per /perfection-review there is NO time-based "cost" — never weigh correct
  process (e.g. a framework-change gate) against time; the gate is simply the
  correct process.
