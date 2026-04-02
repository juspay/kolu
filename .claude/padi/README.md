# Workflow DAG

MCP-driven YAML graphs that drive coding agents through a task. The workflow server (`padi/`) serves one step at a time as a state machine — Claude calls `workflow_complete(evidence)` to advance.

## How it works

Two parts:

1. **YAML graph** (`.claude/padi/*.yaml`) — nodes, transitions, loop limits
2. **MCP server** (`padi/`) — reads the graph, enforces step ordering, gates advancement on evidence

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
/padi do --from polish        # just the police→fix loop
/padi do --from ci-only       # just CI
/padi do --from post-implement # skip research, start at fmt
```

## `do.yaml` — full execution workflow

```mermaid
flowchart TD
  sync["sync\n─────\nFetch latest remote refs"]
  understand["understand\n─────\nResearch task and codebase"]
  hickey["hickey\n─────\nEvaluate approach for structural simplicity"]
  branch["branch\n─────\nBranch + draft PR"]
  implement["implement\n─────\nWrite the code"]
  e2e["e2e\n─────\nAdd/update e2e tests"]
  docs["docs\n─────\nVerify docs are up to date\n⟲ max 3"]
  docs-fix["docs-fix\n─────\nFix outdated docs\n⟲ max 3"]

  subgraph "police.yaml"
    police["police\n─────\nCode review\n⟲ max 3"]
    police-fix["police-fix\n─────\nFix police violations"]
  end

  fmt["fmt\n─────\nAuto-format"]
  commit["commit\n─────\nCommit and push"]
  test["test\n─────\nTargeted e2e tests\n⟲ max 4"]
  test-fix["test-fix\n─────\nFix or retry test failures\n⟲ max 3"]

  subgraph "ci.yaml"
    ci["ci\n─────\nRun CI\n⟲ max 20"]
    ci-triage["ci-triage\n─────\nClassify CI failure\n⟲ max 5"]
    ci-retry["ci-retry\n─────\nRetry flaky CI step\n⟲ max 5"]
    ci-fix["ci-fix\n─────\nFix real CI bug\n⟲ max 5"]
  end

  update-pr["update-pr\n─────\nUpdate PR if needed"]
  done["done\n─────\nReport completion"]

  sync --> understand
  understand --> hickey
  hickey --> branch
  branch --> implement
  implement --> e2e
  e2e --> docs
  docs -->|"docs outdated"| docs-fix
  docs --> police
  docs-fix --> docs
  police -->|"violations or issues found"| police-fix
  police -->|"clean"| fmt
  police-fix -->|"fixed"| fmt
  fmt --> commit
  commit --> test
  test -->|"failed"| test-fix
  test --> ci
  test-fix -->|"fixed"| fmt
  test-fix --> test
  ci -->|"failed"| ci-triage
  ci -->|"done"| update-pr
  ci-triage -->|"flaky"| ci-retry
  ci-triage -->|"real bug"| ci-fix
  ci-retry --> ci
  ci-fix -->|"fixed"| fmt
  update-pr --> done

  classDef included fill:#475569,stroke:#334155,color:#fff
  classDef local fill:#64748b,stroke:#475569,color:#fff
  class police,police-fix,ci,ci-triage,ci-retry,ci-fix included
  class sync,understand,hickey,branch,implement,e2e,fmt,commit,test,test-fix,update-pr,docs,docs-fix,done local
```

### Loop limits

| Node                                | max_visits | Purpose                     |
| ----------------------------------- | ---------- | --------------------------- |
| `police`                            | 3          | Quality convergence         |
| `test`                              | 4          | Covers flaky retries        |
| `test-fix`                          | 3          | Fix attempts                |
| `ci`                                | 20         | CI can be slow to stabilize |
| `ci-triage` / `ci-retry` / `ci-fix` | 5          | Per-failure handling        |
