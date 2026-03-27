"""MCP workflow orchestrator — enforces deterministic step ordering for Claude Code."""

import json
from pathlib import Path

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

STATE_DIR = Path(".kolu/state")
STATE_FILE = STATE_DIR / "workflow.json"
STEPS = ["srid-plan", "srid-do"]

mcp = FastMCP("workflow-orchestrator")


def _read_state() -> dict | None:
    if not STATE_FILE.exists():
        return None
    return json.loads(STATE_FILE.read_text())


def _write_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
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
def workflow_start(task: str) -> str:
    """Start a new workflow for the given task. Creates a two-step pipeline: /srid-plan then /srid-do."""
    existing = _read_state()
    if existing and existing["status"] == "in_progress":
        raise ToolError(
            f"Workflow already in progress (step: /{STEPS[existing['current_step']]}). "
            "Use workflow_reset() to abandon it first."
        )
    state = {
        "task": task,
        "steps": STEPS,
        "current_step": 0,
        "status": "in_progress",
        "step_notes": {},
    }
    _write_state(state)
    return f"Workflow started for: {task}\n\n{_step_info(STEPS[0])}"


@mcp.tool(annotations={"readOnlyHint": True})
def workflow_status() -> str:
    """Get the current workflow status and which step to execute next."""
    state = _read_state()
    if not state:
        return "No active workflow. Use workflow_start(task) to begin."
    if state["status"] == "completed":
        return f"Workflow completed for: {state['task']}"
    step = STEPS[state["current_step"]]
    return (
        f"Task: {state['task']}\n"
        f"Progress: step {state['current_step'] + 1}/{len(STEPS)}\n\n"
        f"{_step_info(step)}"
    )


@mcp.tool(annotations={"readOnlyHint": False})
def workflow_complete_step(notes: str = "") -> str:
    """Mark the current step as complete and advance to the next. Optionally attach notes."""
    state = _require_active_workflow()
    idx = state["current_step"]
    step_name = STEPS[idx]
    if notes:
        state["step_notes"][step_name] = notes

    last_step = idx + 1 >= len(STEPS)
    if last_step:
        state["status"] = "completed"
    else:
        state["current_step"] = idx + 1
    _write_state(state)

    if last_step:
        return f"Step /{step_name} completed. Workflow finished!"
    return f"Step /{step_name} completed.\n\n{_step_info(STEPS[state['current_step']])}"


@mcp.tool(annotations={"destructiveHint": True})
def workflow_reset() -> str:
    """Abandon the current workflow and clear state."""
    state = _read_state()
    if not state:
        return "No workflow to reset."
    task = state["task"]
    STATE_FILE.unlink(missing_ok=True)
    return f"Workflow for '{task}' has been reset."
