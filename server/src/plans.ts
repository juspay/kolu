/**
 * Plan file operations — read content and insert/remove inline feedback.
 *
 * All mutations use optimistic locking via file mtime: read the mtime before
 * modifying, verify it hasn't changed before writing. If Claude (or anything
 * else) modified the file between our read and write, we abort with an error
 * and the client retries against fresh content.
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

/** Read file content + mtime atomically for optimistic locking. */
function readWithMtime(resolved: string): { lines: string[]; mtime: number } {
  const content = fs.readFileSync(resolved, "utf8");
  const stat = fs.statSync(resolved);
  return { lines: content.split("\n"), mtime: stat.mtimeMs };
}

/** Write file only if mtime hasn't changed since we read it.
 *  Throws if the file was modified concurrently (e.g. by Claude). */
function writeIfUnchanged(
  resolved: string,
  lines: string[],
  expectedMtime: number,
): void {
  const currentMtime = fs.statSync(resolved).mtimeMs;
  if (currentMtime !== expectedMtime) {
    throw new Error("Plan file was modified concurrently — refresh and retry");
  }
  fs.writeFileSync(resolved, lines.join("\n"), "utf8");
}

/**
 * Insert inline feedback into a plan file after a specific line.
 * Uses optimistic locking to avoid overwriting concurrent edits.
 */
export function addPlanFeedback(
  filePath: string,
  afterLine: number,
  text: string,
): void {
  const resolved = path.resolve(filePath);
  const { lines, mtime } = readWithMtime(resolved);

  afterLine = Math.max(1, Math.min(afterLine, lines.length));

  const feedbackLines = text
    .split("\n")
    .map((line, i) => (i === 0 ? `> [FEEDBACK]: ${line}` : `> ${line}`));

  lines.splice(afterLine, 0, "", ...feedbackLines, "");

  writeIfUnchanged(resolved, lines, mtime);
}

/**
 * Remove a feedback block from a plan file.
 * Uses optimistic locking to avoid overwriting concurrent edits.
 */
export function removePlanFeedback(
  filePath: string,
  feedbackLine: number,
): void {
  const resolved = path.resolve(filePath);
  const { lines, mtime } = readWithMtime(resolved);

  feedbackLine = Math.max(1, Math.min(feedbackLine, lines.length));
  const idx = feedbackLine - 1;

  if (!lines[idx]?.startsWith("> [FEEDBACK]:")) return;

  let end = idx + 1;
  while (end < lines.length && lines[end]!.startsWith("> ")) {
    end++;
  }

  let start = idx;
  if (start > 0 && lines[start - 1]!.trim() === "") start--;
  if (end < lines.length && lines[end]!.trim() === "") end++;

  lines.splice(start, end - start);

  writeIfUnchanged(resolved, lines, mtime);
}
