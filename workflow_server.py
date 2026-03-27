"""MCP workflow orchestrator — enforces deterministic step ordering for Claude Code."""

import json
import logging
from pathlib import Path

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

STATE_DIR = Path(".kolu/state")
STATE_FILE = STATE_DIR / "workflow.json"
LOG_FILE = STATE_DIR / "workflow.log"
WORKFLOWS_FILE = Path(".kolu/workflows.json")

STATE_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    filename=str(LOG_FILE),
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger("workflow")

mcp = FastMCP("workflow-orchestrator")


def _load_workflows() -> dict[str, list[str]]:
    if not WORKFLOWS_FILE.exists():
        raise ToolError(f"Workflows config not found: {WORKFLOWS_FILE}")
    return json.loads(WORKFLOWS_FILE.read_text())


def _read_state() -> dict | None:
    if not STATE_FILE.exists():
        return None
    return json.loads(STATE_FILE.read_text())


def _write_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\n")


def _step_info(step_name: str) -> str:
    return f"Current step: /{step_name} — invoke the `{step_name}` skill via the Skill tool now."


def _require_active_workflow() -> dict:
    """Load state and raise ToolError if no workflow is in progress."""
    state = _read_state()
    if not state or state["status"] != "in_progress":
        raise ToolError("No active workflow. Use workflow_start(task) to begin.")
    return state


@mcp.tool(annotations={"readOnlyHint": False})
def workflow_start(task: str, workflow: str = "default") -> str:
    """Start a new workflow for the given task. Reads steps from .kolu/workflows.json."""
    existing = _read_state()
    if existing and existing["status"] == "in_progress":
        steps = existing["steps"]
        raise ToolError(
            f"Workflow already in progress (step: /{steps[existing['current_step']]}). "
            "Use workflow_reset() to abandon it first."
        )
    workflows = _load_workflows()
    if workflow not in workflows:
        available = ", ".join(workflows.keys())
        raise ToolError(f"Unknown workflow '{workflow}'. Available: {available}")
    steps = workflows[workflow]
    state = {
        "task": task,
        "workflow": workflow,
        "steps": steps,
        "current_step": 0,
        "status": "in_progress",
        "step_notes": {},
    }
    _write_state(state)
    log.info("started [%s]: %s", workflow, task)
    return f"Workflow '{workflow}' started for: {task}\n\n{_step_info(steps[0])}"


@mcp.tool(annotations={"readOnlyHint": True})
def workflow_status() -> str:
    """Get the current workflow status and which step to execute next."""
    state = _read_state()
    if not state:
        return "No active workflow. Use workflow_start(task) to begin."
    if state["status"] == "completed":
        return f"Workflow completed for: {state['task']}"
    steps = state["steps"]
    step = steps[state["current_step"]]
    return (
        f"Task: {state['task']}\n"
        f"Progress: step {state['current_step'] + 1}/{len(steps)}\n\n"
        f"{_step_info(step)}"
    )


@mcp.tool(annotations={"readOnlyHint": False})
def workflow_complete_step(notes: str = "") -> str:
    """Mark the current step as complete and advance to the next. Optionally attach notes."""
    state = _require_active_workflow()
    steps = state["steps"]
    idx = state["current_step"]
    step_name = steps[idx]
    if notes:
        state["step_notes"][step_name] = notes

    last_step = idx + 1 >= len(steps)
    if last_step:
        state["status"] = "completed"
    else:
        state["current_step"] = idx + 1
    _write_state(state)

    if last_step:
        log.info("completed step: %s (workflow finished)", step_name)
        return f"Step /{step_name} completed. Workflow finished!"
    log.info("completed step: %s → next: %s", step_name, steps[state["current_step"]])
    return f"Step /{step_name} completed.\n\n{_step_info(steps[state['current_step']])}"


@mcp.tool(annotations={"destructiveHint": True})
def workflow_reset() -> str:
    """Abandon the current workflow and clear state."""
    state = _read_state()
    if not state:
        return "No workflow to reset."
    task = state["task"]
    STATE_FILE.unlink(missing_ok=True)
    log.info("reset: %s", task)
    return f"Workflow for '{task}' has been reset."
