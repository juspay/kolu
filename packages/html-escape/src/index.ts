/** HTML-escape a string so it's safe to interpolate into element text or
 *  attribute values. Covers `&`, `<`, `>`, `"`, and `'` — the last is
 *  required for any attribute that might end up single-quoted.
 *
 *  This lives in its own zero-dependency leaf package so app-agnostic
 *  appliances (the static transcript renderer, the scrollback PDF export)
 *  can reach it without pulling in the whole `kolu-common` domain contract
 *  package — which would otherwise drag the entire agent/git/oRPC dependency
 *  tree into a consumer that only needs five string replacements. */
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c);
}
