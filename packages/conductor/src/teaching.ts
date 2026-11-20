import { readFileSync } from "node:fs";

const HOST = "{{host}}";

function withoutNote(source: string): string {
  const body = source.trimStart();
  if (!body.startsWith("<!--")) return assertNoNote(source);
  const end = body.indexOf("-->");
  if (end === -1) {
    throw new Error("teaching.md: the leading <!-- note is never closed");
  }
  return assertNoNote(body.slice(end + "-->".length));
}

function assertNoNote(prompt: string): string {
  if (prompt.includes("<!--")) {
    throw new Error(
      "teaching.md: only the leading <!-- note is not sent; move this one there",
    );
  }
  return prompt;
}

export function parseTeaching(source: string): string {
  const prompt = withoutNote(source).trim();
  if (prompt === "") {
    throw new Error("teaching.md: the standing prompt is empty");
  }
  for (let at = prompt.indexOf("{{"); at !== -1; ) {
    const end = prompt.indexOf("}}", at + 2);
    if (end === -1) break;
    const placeholder = prompt.slice(at, end + 2);
    if (placeholder !== HOST) {
      throw new Error(
        `teaching.md: unknown placeholder ${placeholder} — only ${HOST} is filled in`,
      );
    }
    at = prompt.indexOf("{{", end + 2);
  }
  return prompt;
}

const PROMPT = parseTeaching(
  readFileSync(new URL("./teaching.md", import.meta.url), "utf8"),
);

export const teaching = (host: string): string => PROMPT.replaceAll(HOST, host);
