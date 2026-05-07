/** HTML-escape a string so it's safe to interpolate into element text or
 *  attribute values. Covers `&`, `<`, `>`, `"`, and `'` — the last is
 *  required for any attribute that might end up single-quoted, which is
 *  why the renderer's earlier private copy included it but the client's
 *  did not (a latent bug for single-quoted attribute contexts). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
