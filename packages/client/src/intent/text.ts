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

/** Companion to `annotationLine`: the slot's text color follows the
 *  same intent-vs-branch split. When intent is set the slot inherits
 *  its parent's foreground (intent is plain "annotation"); when the
 *  branch is the fallback the slot uses `branchColor` (the hashed
 *  per-branch hue). Returns `undefined` for the intent case so callers
 *  can drop the `color` property entirely. Keeping this paired with
 *  `annotationLine` in one module means a future change to the
 *  supplant rule's visual cue lands in one place. */
export function annotationColor(
  intent: string | undefined,
  branchColor: string,
): string | undefined {
  return intent ? undefined : branchColor;
}
