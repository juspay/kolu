// `firstIntentLine` and `annotationLine` live with the dock row
// (`@kolu/solid-dockrow/rowValues`), not here: the annotation SLOT is the row's,
// and its rule — intent line 1 when set, the fallback otherwise, never both
// stacked — is one a consumer rendering that row must not re-derive. This module
// keeps the folds that are genuinely about intent TEXT rather than about the
// slot, and re-exports the two so the ~7 client call sites keep one door.
export { annotationLine, firstIntentLine } from "@kolu/solid-dockrow/rowValues";
import { firstIntentLine } from "@kolu/solid-dockrow/rowValues";

/** Stateless. Hoisted to module scope so `firstGrapheme` doesn't
 *  allocate a new segmenter on every reactive update. `Intl.Segmenter`
 *  isn't available on every runtime (SSR / very old browsers); the
 *  helper falls through to a codepoint split when missing. */
const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** Extract the first grapheme cluster from a string. ZWJ-joined and
 *  multi-codepoint emojis (flags, family glyphs) come back as one
 *  cluster; bare codepoints come back as themselves. Empty input
 *  returns the empty string. */
export function firstGrapheme(s: string): string {
  if (s.length === 0) return "";
  if (segmenter) {
    const first = segmenter.segment(s)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...s][0] ?? "";
}

/** Leading characters that mark the intent line as markdown chrome
 *  rather than content — heading hash, blockquote arrow, list/emphasis
 *  punctuation. Stripped before taking the first grapheme so an intent
 *  like `**urgent** fix` glyphs as `u`, not `*`. Square brackets and
 *  hyphens are intentionally excluded — they're as likely to be
 *  meaningful prose as markdown. */
const MARKDOWN_CHROME = /^[\s*_`#>~]+/;

/** First glyph of the intent's display line — the cluster that
 *  represents this intent at a single-character size (dock rail chip).
 *  Strips leading markdown chrome so emoji and letters win over
 *  decorative punctuation. Returns the empty string when the intent
 *  has nothing renderable. */
export function intentLeadGlyph(intent: string): string {
  return firstGrapheme(firstIntentLine(intent).replace(MARKDOWN_CHROME, ""));
}

/** Lines 2+ of the intent — the body that renders in `IntentBody`,
 *  below the annotation slot. Returns `""` when the intent is
 *  single-line or unset; `IntentBody` skips rendering an empty box. */
export function intentBodyMarkdown(intent: string | undefined): string {
  if (!intent) return "";
  const parts = intent.split(/\r?\n/);
  if (parts.length < 2) return "";
  return parts.slice(1).join("\n").replace(/^\n+/, "").trimEnd();
}
