---
description: Execute a workflow DAG — read the graph, follow nodes, pick transitions
argument-hint: "<workflow-name> [--from <entry-point>] [-- <args>]"
---

# Workflow Orchestrator

Execute a workflow defined in `.claude/workflows/<name>.yaml`.

## Setup

1. Read the workflow YAML at `.claude/workflows/$WORKFLOW_NAME.yaml`.
2. Determine the entry point: use `--from <name>` if provided, otherwise `default` from `entry_points`.
3. Store everything after `--` as the task input (available to `prompt` nodes as context).

## Execution Loop

Maintain a visit counter per node (all start at 0).

For the current node:

1. **Check visit limit.** If visits >= `max_visits` (node-level, or `defaults.max_visits`), STOP: `"[workflow] HALT: node '<id>' exceeded max_visits (<N>)."`
2. **Increment visit count.**
3. **Print status:** `[workflow] → <node-id>: <description> (visit <N>/<max>)`
4. **Execute the action:**
   - `skill`: Invoke via the Skill tool — `skill: "<target>"`, `args: "<args>"`.
   - `run`: Execute via Bash tool. Use `run_in_background: true` if description contains "background".
   - `prompt`: Execute the instruction directly — read files, write code, run commands, whatever the prompt says.
5. **Pick the next edge.** Look at the node's `on:` map. For each non-`default` key, evaluate the condition against what just happened (conversation context, command output, skill results). If a condition matches, follow that edge. If none match, follow `default`. If there is no `on:` map, the workflow is **done**.
6. **Continue** with the next node.

## Rules

- **Every commit is NEW.** Never amend, rebase, or force-push.
- **Feature branches only.** Never commit to master/main.
- **Background for CI.** Always run CI commands with `run_in_background: true`.
- **No questions.** Do NOT use `AskUserQuestion` unless a node's prompt explicitly says to. Make sensible default choices.
- **Transparency.** Always print the status line before executing each node.
