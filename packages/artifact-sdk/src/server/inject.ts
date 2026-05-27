/** Splice a `<script>` tag for the artifact-sdk into HTML responses. The
 *  injected tag points at the hashed URL the bundle module exports so
 *  cache-busting is automatic when the SDK source changes. */

export function decorateHtml(html: string, scriptUrl: string): string {
  const tag = `<script src="${scriptUrl}"></script>`;
  // Case-insensitive close-body splice; preserve the original `</body>`
  // tag's case so we don't rewrite user HTML beyond the injection itself.
  // If no `</body>` (malformed or fragment HTML), append at the end —
  // either way the SDK executes.
  const match = html.match(/<\/body>/i);
  if (match) {
    const idx = match.index ?? html.length;
    return html.slice(0, idx) + tag + html.slice(idx);
  }
  return `${html}${tag}`;
}
