/** Clipboard payload — `[kolu comments v1]` envelope is the stable
 *  contract; agents parse the version to dispatch. Body is a Markdown
 *  bullet list (`- \`path:Lrange\` — text`) so the same payload renders
 *  cleanly in GitHub / Slack / chat surfaces while staying mechanical
 *  enough for an agent to regex out. Sorted by (path, startLine) so the
 *  paste reads as a repo walk. */

import { formatLPathRef } from "../ui/lineRef";

export type Comment = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  createdAt: number;
};

const HEADER = "[kolu comments v1]";

export function serializeComments(comments: readonly Comment[]): string {
  const sorted = [...comments].sort((a, b) => {
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.startLine - b.startLine;
  });
  const body = sorted
    .map(
      (c) =>
        `- \`${formatLPathRef(c.path, c.startLine, c.endLine)}\` — ${c.text}`,
    )
    .join("\n");
  return `${HEADER}\n\n${body}\n`;
}
