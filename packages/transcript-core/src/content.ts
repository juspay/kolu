/** Pull plain text out of an agent JSONL `content` field shaped as a bare
 *  string or an array of blocks (`[{type:"text", text:"…"}, …]`). Grok's
 *  chat history, pi's session JSONL, and omp's fork of pi's layout all use
 *  this exact envelope. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join("\n");
}
