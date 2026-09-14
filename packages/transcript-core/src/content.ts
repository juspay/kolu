/** Agent-neutral JSONL content readers. A function lands here only when two
 *  or more agents share the exact same wire shape — forks of one storage
 *  lineage, not a guess at a universal envelope. */

/** Pull plain text out of an agent JSONL `content` field shaped as a bare
 *  string or an array of blocks (`[{type:"text", text:"…"}, …]`). Grok's
 *  chat history, pi's session JSONL, and omp's fork of pi's layout all use
 *  this exact envelope, which is why the reader lives here rather than in
 *  three copies. An agent with a typed or richer block model (xyne splits
 *  `{text, thinking}`) keeps its own reader. */
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
