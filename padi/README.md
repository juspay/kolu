# padi

MCP server that drives workflow execution as a state machine. Reads YAML workflow definitions, manages sessions, gates step progression on evidence submission, and records results.

The server is generic — it knows nothing about kolu, skills, or CI. It parses a DAG from YAML and enforces the graph structure. The agent interprets instructions and decides which edges to follow.

## Tools

| Tool                | Description                           |
| ------------------- | ------------------------------------- |
| `workflow_list`     | List available workflows              |
| `workflow_start`    | Start a session, get first step       |
| `workflow_current`  | Get current step instruction          |
| `workflow_complete` | Submit evidence, advance to next step |
| `workflow_status`   | Full progress with history            |

## How to use

### 1. Build

```sh
cd padi
nix build
```

### 2. Configure Claude Code

The repo's `.mcp.json` is already set up:

```json
{
  "mcpServers": {
    "workflow": {
      "command": "nix",
      "args": ["run", "./padi"]
    }
  }
}
```

Restart Claude Code to pick up the MCP server.

### 3. Test interactively

Once the MCP server is connected, Claude Code can call the tools directly:

```
> Use workflow_list to see available workflows
> Use workflow_start with workflow "do" to begin
> Use workflow_current to see what to do
> Use workflow_complete with evidence "done" to advance
> Use workflow_status to see progress
```

### 4. Verify the server starts

```sh
nix run ./padi  # starts on stdio, ctrl-c to exit
```

## How it works

1. `workflow_start("do")` → parses `.claude/padi/do.yaml`, creates an in-memory session, returns the first node's instruction
2. Agent executes the instruction (run a command, write code, etc.)
3. Agent calls `workflow_complete(evidence, edge?)` → server records evidence, resolves the next edge, checks visit limits, advances
4. Repeat until terminal node or halt

Sessions are ephemeral (in-memory). Results are written to `.workflow-runs/<session-id>/results.yaml` as an append-only execution record.

## Composable workflows

Workflows can include nodes from external YAML files via `include:`. Fragments declare exit **ports** — named boundary points that the includer wires to its own nodes.

```yaml
# ci.yaml — reusable CI gate
ports:
  # CI passed
  done:
  # Real bug found and fixed
  fixed:
nodes:
  ci:
    prompt: "Run: just ci (in background)"
    on:
      "failed": ci-triage
      default: :done
  ci-triage:
    prompt: Classify failure — flaky or real bug?
    on:
      "flaky": ci-retry
      "real bug": ci-fix
  ci-retry:
    prompt: Re-run the failing step.
    on:
      default: ci
  ci-fix:
    prompt: Fix the bug.
    on:
      default: :fixed
```

```yaml
# do.yaml — parent wires ports to its own nodes
include:
  - path: ./ci.yaml
    on:
      done: update-pr
      fixed: fmt # fmt → commit → test → ci (natural loop)
```

Prompts support `{{keypath}}` interpolation — reference same-file YAML data:

```yaml
rules:
  - id: no-dead-code
    rule: Remove unused code.
nodes:
  review:
    prompt: |
      Check these rules:
      {{rules}}
```

Bare string includes (no ports) also work: `include: [./extra-nodes.yaml]`.

Parse-time validation catches: unwired ports, undeclared port references, name collisions, circular includes, dangling edge targets, and missing template keys.

## Design

- **Evidence is opaque** — server records strings, doesn't interpret them
- **Edge resolution is agent-driven** — server validates the edge exists, agent chooses which condition matched
- **Auto-advance on default-only edges** — no need to specify `edge` when there's only a default
- **Visit limits enforced** — server halts if a node exceeds `max_visits`
