export function decorateHtml(html: string, scriptUrl: string): string {
  const tag = `<script src="${scriptUrl}"></script>`;
  const match = html.match(/<\/body>/i);
  if (match) {
    const idx = match.index ?? html.length;
    return html.slice(0, idx) + tag + html.slice(idx);
  }
  return `${html}${tag}`;
}
