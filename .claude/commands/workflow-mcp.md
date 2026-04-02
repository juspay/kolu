# MCP-Driven Workflow

Execute a workflow via the MCP workflow server. The server enforces step ordering — you cannot skip steps.

## Arguments

Parse the arguments string: `<workflow-name> [--review] [--from <node>] [-- <task input>]`

- `workflow-name`: Which workflow to run (e.g., `do-mcp`)
- `--review`: Pause before implementation for user plan approval
- `--from <node>`: Start from a specific entry point
- `-- <task input>`: Everything after `--` is the task description

## Execution

### 1. Start the workflow

Call `workflow_start` with:

- `workflow`: the workflow name
- `entryPoint`: value of `--from`, or `"default"` if omitted
- `input`: the task input (everything after `--`)

### 2. Print progress and execute the current step

**Before every step**, print the `progress` line from the response. Example:

```
[workflow] ✓sync ✓understand ▸hickey · branch · implement · e2e · fmt · commit · police · test · ci · update-pr · docs · done
```

Read the `currentNode` from the response:

- **`instruction.type === "prompt"`**: Execute the prompt text directly — read files, write code, run commands, invoke skills, whatever it says.
- **`instruction.type === "run"`**: Execute the command via Bash.
- **`instruction.type === "skill"`**: Invoke the skill via the Skill tool.

### 3. Complete the step

Call `workflow_complete` with:

- `evidence`: A brief summary of what happened (1-2 sentences)
- `edge`: If the node has conditional edges (not just `default`), evaluate the outcome and specify which edge condition matched. Omit for default-only nodes.

### 4. Handle the response

- **`status: "running"`**: Go back to step 2 with the new `currentNode`.
- **`status: "completed"`**: Workflow is done. Report the result.
- **`status: "halted"`**: A node exceeded its visit limit. Report the halt reason.

### 5. Review mode (`--review`)

If `--review` was specified:

- After the research/planning steps complete (before implementation begins), **stop the loop**.
- Present the plan for the task.
- Enter plan mode via `EnterPlanMode` for user approval.
- After user approves via `ExitPlanMode`, resume the loop from the next step.

## Rules

- **Never skip steps.** The server enforces this, but don't try to work around it.
- **Every commit is NEW.** Never amend, rebase, or force-push.
- **Feature branches only.** Never commit to master/main.
- **Background for CI.** Run CI commands with `run_in_background: true`.
- **No questions.** Don't use `AskUserQuestion` unless `--review` is active during planning, or the step instruction explicitly says to.
- **Never stop between steps.** After completing a step, immediately proceed to the next one.

## Example

```
/workflow-mcp do-mcp --review -- Fix the login timeout bug described in #42
```

ARGUMENTS: $ARGUMENTS
