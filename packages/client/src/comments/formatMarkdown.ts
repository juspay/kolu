/** Format a list of comments as a plain Markdown list for the clipboard.
 *  No sentinel wrapper, no version tag — the agent reads natural
 *  Markdown. Each entry's quote line is the recovery hint so the agent
 *  can re-locate the position when the file has been edited. */

import type { Comment } from "./types";

function escapeQuote(s: string): string {
  // Newlines inside the quote would break the single-line `> "…"` shape;
  // collapse them. Embedded `"` stays — Markdown doesn't escape inside `>`.
  return s.replace(/\s*\n+\s*/g, " ").trim();
}

function formatBody(body: string): string {
  // Multi-line bodies become continuation lines indented two spaces so
  // the list item stays one item under most Markdown renderers.
  const lines = body.split(/\r?\n/).map((l) => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => `  ${l}`).join("\n");
}

export function formatMarkdown(comments: Comment[]): string {
  if (comments.length === 0) return "";
  return comments
    .map((c) => {
      const quote = escapeQuote(c.locator.quote);
      const head = `- ${c.path}\n  > "${quote}"`;
      const body = c.body.trim();
      if (body === "") return head;
      return `${head}\n${formatBody(body)}`;
    })
    .join("\n\n");
}
