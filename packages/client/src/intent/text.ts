/** First display line for compact intent tabs. */
export function firstIntentLine(intent: string): string {
  return intent.split(/\r?\n/, 1)[0] ?? "";
}

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
function firstGrapheme(s: string): string {
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

/** The annotation line for a render site: intent line-1 when the user
 *  set one, otherwise the supplied fallback (typically the branch name
 *  or sub-tab label). One slot per render site — never both stacked,
 *  so the intent's first-grapheme glyph appears only here and not as a
 *  separate chip elsewhere on the same card. */
export function annotationLine(
  intent: string | undefined,
  fallback: string,
): string {
  if (intent) return firstIntentLine(intent);
  return fallback;
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
