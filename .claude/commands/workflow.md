---
description: Execute a workflow DAG — read the graph, follow nodes, pick transitions
argument-hint: "<workflow-name> [--review] [--from <entry-point>] [--dry-run] [-- <args>]"
---

# Workflow Orchestrator

Execute a workflow defined in `.claude/workflows/<name>.yaml`.

## Setup

1. Read the workflow YAML at `.claude/workflows/$WORKFLOW_NAME.yaml`.
2. Determine the entry point: use `--from <name>` if provided, otherwise `default` from `entry_points`.
3. Store everything after `--` as the task input (available to `prompt` nodes as context).
4. Check for `--dry-run` and `--review` flags.

## Review mode (`--review`)

Default is autonomous (no user interaction). With `--review`:

1. Run the **understand** and **hickey** nodes normally (research + simplicity check).
2. Write the plan to `.workflow-runs/<branch-name>/plan.md`.
3. **Enter plan mode** (via `EnterPlanMode` tool) and present the plan for user review.
4. Wait for user approval via `ExitPlanMode`.
5. Once approved, proceed autonomously through the rest of the graph — no further user interaction.

Without `--review`, the entire graph runs autonomously end-to-end.

## Artifacts

Each workflow run produces artifacts in `.workflow-runs/<branch-name>/`:

- **`plan.md`** — The plan/task description. Written before implementation starts. Committed to git as the first commit on the feature branch.
- **`summary.md`** — Execution summary, updated incrementally as each node completes. Contains:
  - Task input / description
  - Graph path traversed (every node visited, in order, with visit counts)
  - Edges taken and why (which condition matched at each branch point)
  - Per-node reports: what happened, what was produced, any issues found
  - Loop iterations (e.g., "police visited 2/3 times: violations on visit 1, clean on visit 2")
  - PR URL (added as soon as draft PR is created, updated if PR is edited)
  - Final outcome: success or halt reason

If the workflow halts mid-run, the summary still captures everything up to that point.

## Dry-run mode (`--dry-run`)

**Do not execute any actions.** Walk the graph and for each node:

1. Print: `[dry-run] → <node-id>: <description> (<type>: <target>) (max_visits: <N>)`
2. List all outgoing edges: `  → on "<condition>": <target-node>` and `  → on default: <target-node>`
3. For conditional edges, assume `default` is taken (happy path).
4. Continue until a terminal node (no `on:` map) or a cycle is detected.

After the walk, print the full path taken and total node count.

## Execution Loop (skipped in dry-run)

Maintain a visit counter per node (all start at 0).

For the current node:

1. **Check visit limit.** If visits >= `max_visits` (node-level, or `defaults.max_visits`), STOP: `"[workflow] HALT: node '<id>' exceeded max_visits (<N>)."` Write summary.md with halt reason.
2. **Increment visit count.**
3. **Print status:** `[workflow] → <node-id>: <description> (visit <N>/<max>)`
4. **Execute the action:**
   - `skill`: Invoke via the Skill tool — `skill: "<target>"`, `args: "<args>"`.
   - `run`: Execute via Bash tool. Use `run_in_background: true` if description contains "background".
   - `prompt`: Execute the instruction directly — read files, write code, run commands, whatever the prompt says.
5. **Record in summary.md** — Append the node's result: what happened, which edge will be taken and why.
6. **Pick the next edge.** Look at the node's `on:` map. For each non-`default` key, evaluate the condition against what just happened (conversation context, command output, skill results). If a condition matches, follow that edge. If none match, follow `default`. If there is no `on:` map, the workflow is **done**.
7. **Continue** with the next node.

## Rules

- **Every commit is NEW.** Never amend, rebase, or force-push.
- **Feature branches only.** Never commit to master/main.
- **Background for CI.** Always run CI commands with `run_in_background: true`.
- **No questions.** Do NOT use `AskUserQuestion` unless `--review` is active during the planning phase, or a node's prompt explicitly says to. Make sensible default choices.
- **Transparency.** Always print the status line before executing each node.
