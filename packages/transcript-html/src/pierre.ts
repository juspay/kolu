/** Pierre SSR adapters for the static transcript export.
 *
 *  Calls `@pierre/diffs/ssr` to render code surfaces (file diffs, full
 *  files, raw patches) at export time. Each prerendered chunk is
 *  wrapped in a `<diffs-container>` host element. The companion
 *  bootstrap script (PIERRE_BOOTSTRAP) registers that custom element,
 *  attaches a shadow root, and adopts a singleton stylesheet — so 100
 *  chunks share one copy of Pierre's ~43KB core CSS instead of
 *  inlining it per call.
 *
 *  We deliberately re-implement Pierre's `web-components.js` instead
 *  of bundling Pierre's runtime classes: hydration of a static export
 *  only needs `attachShadow + adoptedStyleSheets + innerHTML` move.
 *  The interactive `File`/`FileDiff` classes (line selection, theme
 *  swap, hover highlighting) are not relevant for a read-only
 *  document and would balloon the inlined JS by an order of
 *  magnitude. */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePatchFiles } from "@pierre/diffs";
import {
  preloadFile,
  preloadFileDiff,
  preloadMultiFileDiff,
} from "@pierre/diffs/ssr";
import { escapeHtml } from "@kolu/html-escape";

/** Read Pierre's compiled `style.js` module and pull out the core CSS
 *  string literal. The file shape is `var style_default = "...";
 *  export default style_default;` — one assignment per file in the
 *  shipped dist. We grab the literal, JSON.parse it back to a real
 *  string, and feed it to a singleton CSSStyleSheet at hydration.
 *
 *  Pierre's `exports` map declares only the `import` (ESM) condition,
 *  so `createRequire(...).resolve` (which uses the CJS `require`
 *  condition) fails. `import.meta.resolve` runs through ESM
 *  resolution and DOES see the `import` condition — that's what we
 *  use here. From the resolved `dist/ssr/index.js` URL we walk up
 *  twice to land in `dist/`, where `style.js` sits. Pierre would
 *  have to restructure its published dist tree to break this. */
function loadPierreCoreCss(): string {
  const ssrUrl = import.meta.resolve("@pierre/diffs/ssr");
  const ssrPath = fileURLToPath(ssrUrl);
  const distDir = dirname(dirname(ssrPath));
  const stylePath = join(distDir, "style.js");
  const src = readFileSync(stylePath, "utf8");
  const match = /var style_default = ("(?:\\.|[^"\\])*");/.exec(src);
  if (!match) {
    throw new Error(
      "transcript-html: failed to extract Pierre core CSS from @pierre/diffs/dist/style.js",
    );
  }
  return JSON.parse(match[1] ?? "") as string;
}

let cachedCoreCss: string | null = null;
function getPierreCoreCss(): string {
  if (cachedCoreCss === null) cachedCoreCss = loadPierreCoreCss();
  return cachedCoreCss;
}

/** Drop the per-chunk `<style data-core-css>` Pierre emits. The same
 *  ~43KB sits inside every prerendered chunk; we hoist it once into
 *  the shadow-root stylesheet via the bootstrap, so the per-chunk
 *  copies are pure duplicate weight. */
function stripCoreStyle(html: string): string {
  return html.replace(
    /<style[^>]*\bdata-core-css\b[^>]*>[\s\S]*?<\/style>/g,
    "",
  );
}

function wrapInContainer(prerenderedHTML: string): string {
  return `<diffs-container data-pierre>${stripCoreStyle(prerenderedHTML)}</diffs-container>`;
}

/** Render an Edit-style change (oldText → newText) as a unified diff
 *  inside a `<diffs-container>`. Pierre synthesizes the patch via
 *  jsdiff and tokenizes both sides with shiki. */
export async function renderEdit(
  filePath: string,
  oldText: string,
  newText: string,
): Promise<string> {
  const result = await preloadMultiFileDiff({
    oldFile: { name: filePath, contents: oldText },
    newFile: { name: filePath, contents: newText },
    options: { diffStyle: "unified", themeType: "system" },
  });
  return wrapInContainer(result.prerenderedHTML);
}

/** Render a brand-new file (Write tool) as a Pierre file view. The
 *  file header carries the path; lines are syntax-highlighted by
 *  shiki using the filename to infer language. */
export async function renderWrite(
  filePath: string,
  content: string,
): Promise<string> {
  const result = await preloadFile({
    file: { name: filePath, contents: content },
    options: { themeType: "system" },
  });
  return wrapInContainer(result.prerenderedHTML);
}

/** Render a unified-diff patch payload — `kind: "patch"` carries
 *  standard `git diff` text by the time it reaches the renderer (the
 *  Codex loader normalizes its `*** Begin Patch` envelope to unified
 *  diff at the IR boundary). Pierre's `parsePatchFiles` handles
 *  multi-file payloads; we emit one `<diffs-container>` per file
 *  via `preloadFileDiff`. If parsing fails, we fall back to an
 *  escaped `<pre>` so the whole export doesn't crash on a malformed
 *  payload. */
export async function renderPatch(patch: string): Promise<string> {
  const parsed = parsePatchFiles(patch);
  const fileDiffs = parsed.flatMap((p) => p.files);
  if (fileDiffs.length === 0) {
    return `<pre class="card-text card-text--code">${escapeHtml(patch)}</pre>`;
  }
  const chunks = await Promise.all(
    fileDiffs.map(async (fileDiff) => {
      const result = await preloadFileDiff({
        fileDiff,
        options: { diffStyle: "unified", themeType: "system" },
      });
      return wrapInContainer(result.prerenderedHTML);
    }),
  );
  return chunks.join("");
}

/** Render a markdown fenced code block. Pierre infers language from
 *  the synthetic filename's extension; the file header and gutter
 *  are suppressed so an inline code block reads as code, not a file
 *  view. */
export async function renderCodeBlock(
  text: string,
  lang: string | undefined,
): Promise<string> {
  const ext = lang && /^[a-zA-Z0-9]+$/.test(lang) ? `.${lang}` : ".txt";
  const result = await preloadFile({
    file: { name: `block${ext}`, contents: text },
    options: {
      themeType: "system",
      disableFileHeader: true,
      disableLineNumbers: true,
    },
  });
  return wrapInContainer(result.prerenderedHTML);
}

/** Inline JS that registers `<diffs-container>` and hydrates every
 *  Pierre-emitted chunk into a shadow root with one shared core
 *  stylesheet. Mirrors `@pierre/diffs/dist/components/web-components.js`
 *  with one addition: it moves the host's light-DOM children into the
 *  shadow root, since SSR puts the prerendered HTML directly inside
 *  the host element rather than handing it to a runtime hydrate
 *  call. */
export function buildPierreBootstrap(): string {
  const css = JSON.stringify(getPierreCoreCss());
  return `(function () {
  const CORE_CSS = ${css};
  let sheet = null;
  function getSheet() {
    if (sheet) return sheet;
    sheet = new CSSStyleSheet();
    sheet.replaceSync(CORE_CSS);
    return sheet;
  }
  class DiffsContainer extends HTMLElement {
    connectedCallback() {
      if (this.__pierreHydrated) return;
      this.__pierreHydrated = true;
      const html = this.innerHTML;
      this.innerHTML = "";
      const sr = this.shadowRoot || this.attachShadow({ mode: "open" });
      sr.adoptedStyleSheets = [getSheet()];
      sr.innerHTML = html;
    }
  }
  if (!customElements.get("diffs-container")) {
    customElements.define("diffs-container", DiffsContainer);
  }
})();`;
}
