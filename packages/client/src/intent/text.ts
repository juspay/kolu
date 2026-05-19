/** First display line for compact intent tabs. */
export function firstIntentLine(intent: string): string {
  return intent.split(/\r?\n/, 1)[0] ?? "";
}

/** True when the intent contains content beyond its first display line. */
export function hasMultipleIntentLines(intent: string): boolean {
  return /\r?\n/.test(intent);
}
