/** Comment-tray clipboard payload — versioned text format an agent paste
 *  parses back into structured feedback. The envelope (`[kolu comments
 *  v1]`) is the only stable contract; the body shape can evolve under a
 *  bumped version without breaking deployed agent prompts.
 *
 *  Sorted by (path, startLine) so a paste reads as a coherent walk through
 *  the repo, not the chronological order of clicks. */

import { formatRange } from "../ui/lineRef";

export type Comment = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  createdAt: number;
};

const HEADER = "[kolu comments v1]";

export function formatLineRange(startLine: number, endLine: number): string {
  return `L${formatRange(startLine, endLine)}`;
}

export function serializeComments(comments: readonly Comment[]): string {
  const sorted = [...comments].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.startLine - b.startLine;
  });
  const body = sorted
    .map(
      (c) =>
        `${c.path}  ${formatLineRange(c.startLine, c.endLine)}\n  > ${c.text}`,
    )
    .join("\n\n");
  return `${HEADER}\n\n${body}\n`;
}
