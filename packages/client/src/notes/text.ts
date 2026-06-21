/** First display line of a terminal's notes — the annotation slot text. */
export function firstNotesLine(notes: string): string {
  return notes.split(/\r?\n/, 1)[0] ?? "";
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
export function firstGrapheme(s: string): string {
  if (s.length === 0) return "";
  if (segmenter) {
    const first = segmenter.segment(s)[Symbol.iterator]().next();
    if (!first.done) return first.value.segment;
  }
  return [...s][0] ?? "";
}

/** Leading characters that mark the notes line as markdown chrome
 *  rather than content — heading hash, blockquote arrow, list/emphasis
 *  punctuation. Stripped before taking the first grapheme so a notes
 *  line like `**urgent** fix` glyphs as `u`, not `*`. Square brackets and
 *  hyphens are intentionally excluded — they're as likely to be
 *  meaningful prose as markdown. */
const MARKDOWN_CHROME = /^[\s*_`#>~]+/;

/** First glyph of the notes' display line — the cluster that
 *  represents these notes at a single-character size (dock rail chip).
 *  Strips leading markdown chrome so emoji and letters win over
 *  decorative punctuation. Returns the empty string when the notes
 *  have nothing renderable. */
export function notesLeadGlyph(notes: string): string {
  return firstGrapheme(firstNotesLine(notes).replace(MARKDOWN_CHROME, ""));
}

/** The annotation line for a render site: notes line-1 when the user
 *  set one, otherwise the supplied fallback (typically the branch name
 *  or sub-tab label). One slot per render site — never both stacked,
 *  so the notes' first-grapheme glyph appears only here and not as a
 *  separate chip elsewhere on the same card. */
export function annotationLine(
  notes: string | undefined,
  fallback: string,
): string {
  if (notes) return firstNotesLine(notes);
  return fallback;
}

/** Lines 2+ of the notes — the body that renders in `NotesBody`,
 *  below the annotation slot. Returns `""` when the notes are
 *  single-line or unset; `NotesBody` skips rendering an empty box. */
export function notesBodyMarkdown(notes: string | undefined): string {
  if (!notes) return "";
  const parts = notes.split(/\r?\n/);
  if (parts.length < 2) return "";
  return parts.slice(1).join("\n").replace(/^\n+/, "").trimEnd();
}
