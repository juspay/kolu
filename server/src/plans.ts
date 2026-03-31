/**
 * Plan file operations — read content and insert inline feedback.
 *
 * Pure file operations, no state. The metadata provider (meta/plans.ts) handles
 * directory watching and discovery; this module handles content access.
 */

import fs from "node:fs";
import path from "node:path";
import type { PlanContent } from "kolu-common";

/** Read a plan file's content. Throws if file doesn't exist or isn't a .md file. */
export function getPlanContent(filePath: string): PlanContent {
  const resolved = path.resolve(filePath);
  if (!resolved.endsWith(".md")) {
    throw new Error("Plan files must be .md files");
  }

  const content = fs.readFileSync(resolved, "utf8");
  const stat = fs.statSync(resolved);
  return {
    path: resolved,
    content,
    modifiedAt: stat.mtimeMs,
  };
}

/**
 * Insert inline feedback into a plan file after a specific line.
 *
 * Feedback is formatted as a blockquote:
 *   > [FEEDBACK]: <text>
 *
 * Inserts a blank line before and after the blockquote for readability.
 */
export function addPlanFeedback(
  filePath: string,
  afterLine: number,
  text: string,
): void {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, "utf8");
  const lines = content.split("\n");

  // Clamp to valid range — line numbers from the client may be stale
  // if the plan was modified between read and feedback submission
  afterLine = Math.max(1, Math.min(afterLine, lines.length));

  // Format feedback as blockquote lines
  const feedbackLines = text
    .split("\n")
    .map((line, i) => (i === 0 ? `> [FEEDBACK]: ${line}` : `> ${line}`));

  // Insert after the specified line with surrounding blank lines
  const insertion = ["", ...feedbackLines, ""];
  lines.splice(afterLine, 0, ...insertion);

  fs.writeFileSync(resolved, lines.join("\n"), "utf8");
}

/**
 * Remove a feedback block from a plan file.
 * Deletes the `> [FEEDBACK]: ...` line and any continuation `> ` lines,
 * plus surrounding blank lines added during insertion.
 */
export function removePlanFeedback(
  filePath: string,
  feedbackLine: number,
): void {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, "utf8");
  const lines = content.split("\n");

  feedbackLine = Math.max(1, Math.min(feedbackLine, lines.length));
  const idx = feedbackLine - 1; // 0-based

  if (!lines[idx]?.startsWith("> [FEEDBACK]:")) return;

  // Find the extent of the feedback block (> [FEEDBACK]: + continuation > lines)
  let end = idx + 1;
  while (end < lines.length && lines[end]!.startsWith("> ")) {
    end++;
  }

  // Also remove surrounding blank lines added during insertion
  let start = idx;
  if (start > 0 && lines[start - 1]!.trim() === "") start--;
  if (end < lines.length && lines[end]!.trim() === "") end++;

  lines.splice(start, end - start);
  fs.writeFileSync(resolved, lines.join("\n"), "utf8");
}
