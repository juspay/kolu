# Workflow DAG

MCP-driven YAML graphs that drive coding agents through a task. The workflow server (`workflow-mcp/`) serves one step at a time as a state machine — Claude calls `workflow_complete(evidence)` to advance.

## How it works

Two parts:

1. **YAML graph** (`.claude/workflows/*.yaml`) — nodes, transitions, loop limits
2. **MCP server** (`workflow-mcp/`) — reads the graph, enforces step ordering, gates advancement on evidence

All nodes are `prompt` type — the server decides what runs, Claude executes the instruction.

### Transitions

Each node has an `on:` map of `condition → next-node`. Conditions are natural language — Claude evaluates them against what happened. `default` is the else branch.

```yaml
police:
  prompt: |
    Run code-police: review for quality, fact-check for correctness,
    and evaluate for elegance.
  max_visits: 3
  on:
    "violations or issues found": police-fix
    default: test
```

### Loop protection

Each node has `max_visits` (default: 1). The server halts if exceeded.

### Entry points

Start mid-graph with `--from`:

```
/workflow do --from polish        # just the police→fix loop
/workflow do --from ci-only       # just CI
/workflow do --from post-implement # skip research, start at fmt
```

## `do.yaml` — full execution workflow

```mermaid
flowchart TD
  sync["sync\n─────\nFast-forward to latest remote"]
  understand["understand\n─────\nResearch task and codebase"]
  hickey["hickey\n─────\nEvaluate approach for structural simplicity"]
  branch["branch\n─────\nBranch + draft PR"]
  implement["implement\n─────\nWrite the code"]
  e2e["e2e\n─────\nAdd/update e2e tests"]
  fmt["fmt\n─────\nAuto-format"]
  commit["commit\n─────\nCommit and push"]
  police["police\n─────\nCode quality + fact-check + elegance review\n⟲ max 3"]
  police-fix["police-fix\n─────\nFix police violations\n⟲ max 3"]
  test["test\n─────\nQuick e2e tests\n⟲ max 4"]
  test-fix["test-fix\n─────\nFix or retry test failures\n⟲ max 3"]
  ci["ci\n─────\nRun CI\n⟲ max 20"]
  ci-fix["ci-fix\n─────\nAnalyze and fix/retry CI failure\n⟲ max 5"]
  update-pr["update-pr\n─────\nUpdate PR if needed"]
  docs["docs\n─────\nVerify docs are up to date\n⟲ max 3"]
  docs-fix["docs-fix\n─────\nFix outdated docs\n⟲ max 3"]
  done["done\n─────\nReport completion"]

  sync --> understand
  understand --> hickey
  hickey --> branch
  branch --> implement
  implement --> e2e
  e2e --> fmt
  fmt --> commit
  commit --> police
  police -->|"violations or issues found"| police-fix
  police --> test
  police-fix --> police
  test -->|"failed"| test-fix
  test --> ci
  test-fix --> test
  ci -->|"failed"| ci-fix
  ci --> update-pr
  ci-fix -->|"fixed with new commit"| ci
  ci-fix --> update-pr
  update-pr --> docs
  docs -->|"docs outdated"| docs-fix
  docs --> done
  docs-fix --> docs

  classDef prompt fill:#64748b,stroke:#475569,color:#fff
  class sync,understand,hickey,branch,implement,e2e,fmt,commit,police,police-fix,test,test-fix,ci,ci-fix,update-pr,docs,docs-fix,done prompt
```

### Loop limits

| Node                    | max_visits | Purpose                     |
| ----------------------- | ---------- | --------------------------- |
| `police` / `police-fix` | 3          | Quality convergence         |
| `test`                  | 4          | Covers flaky retries        |
| `test-fix`              | 3          | Real fix attempts           |
| `ci`                    | 20         | CI can be slow to stabilize |
| `ci-fix`                | 5          | Fix attempts per CI cycle   |
