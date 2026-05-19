/** First display line for compact intent tabs. */
export function firstIntentLine(intent: string): string {
  return intent.split(/\r?\n/, 1)[0] ?? "";
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
