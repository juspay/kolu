/** `s` as a literal inside a `RegExp` — for a locator's exact `hasText`. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
