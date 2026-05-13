/** Clipboard payload — `[kolu comments v1]` envelope is the stable
 *  contract; agents parse the version to dispatch. Sorted by
 *  (path, startLine) so the paste reads as a repo walk. */

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
