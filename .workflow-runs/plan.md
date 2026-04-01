# Fix duplicate plan.md in workflow

## Problem

The `branch` node in `do.yaml` creates duplicate `plan.md` files. It commits `plan.md` to `.workflow-runs/plan.md`, then after PR creation uses filesystem `mv` to move it to `.workflow-runs/PR-<num>/plan.md`. But `mv` doesn't stage the deletion in git, so the original remains committed alongside the copy.

Observed in PR #284: both `.workflow-runs/plan.md` and `.workflow-runs/PR-284/plan.md` appear in the diff as separate new files with identical content.

## Fix

Change `mv` to `git mv` in the `branch` node prompt in `.claude/workflows/do.yaml`. `git mv` atomically stages both the deletion of the source and the addition at the destination, eliminating the forgotten-cleanup bug.

One-line change, no structural redesign needed.
