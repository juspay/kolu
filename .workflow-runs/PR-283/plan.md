# Plan: Workflow graph progress display

**Issue:** #280 (comment)

## Problem

The workflow status line only shows the current node: `[workflow] → implement: Write the code (visit 1/1)`. No way to see overall position in the graph.

## Solution

Modify `.claude/commands/workflow.md` to:

1. **Setup**: Add step to compute the happy path by walking `default` edges from entry to terminal node
2. **Status display**: Replace single-node status with full-path progress line using markers:
   - `✓` = completed node
   - `▸` = current node
   - `·` = pending node
3. **Example**: `[workflow] ✓sync ✓understand ✓hickey ✓branch ▸implement · e2e · fmt · commit · police · test · ci · update-pr · done`

Fix/loop nodes (police-fix, test-fix, ci-fix) don't appear in the progress line — the parent happy-path node stays as ▸ current until the loop resolves.

## PR

https://github.com/juspay/kolu/pull/283

## Files changed

- `.claude/commands/workflow.md` — Setup section + Execution Loop step 3
