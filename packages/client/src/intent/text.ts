import { annotationLine, firstIntentLine } from "@kolu/solid-dockrow/rowValues";

export { annotationLine, firstIntentLine };

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

export function firstGrapheme(s: string): string {
  if (s.length === 0) return "";
  if (segmenter) {
    const first = segmenter.segment(s)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...s][0] ?? "";
}

const MARKDOWN_CHROME = /^[\s*_`#>~]+/;

export function intentLeadGlyph(intent: string): string {
  return firstGrapheme(firstIntentLine(intent).replace(MARKDOWN_CHROME, ""));
}

export function intentBodyMarkdown(intent: string | undefined): string {
  if (!intent) return "";
  const parts = intent.split(/\r?\n/);
  if (parts.length < 2) return "";
  return parts.slice(1).join("\n").replace(/^\n+/, "").trimEnd();
}
