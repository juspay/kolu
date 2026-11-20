import type { Comment } from "./types";

function escapeQuote(s: string): string {
  return s.replace(/\s*\n+\s*/g, " ").trim();
}

function formatBody(body: string): string {
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
