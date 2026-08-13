/**
 * The shell's `<head>`: what this package writes into it, and in what ORDER.
 *
 * INTERNAL — deliberately off the package's `exports` map (the `./precompress`
 * precedent). The pieces a consumer is meant to reach (`injectShellCommit` for
 * its own shell templating, `SHELL_COMMIT_GLOBAL`/`shellCommitScript*` for the
 * `/vite` plugin and the page-side reader) are re-exported from `./index`, so
 * this file's existence changes no public surface.
 *
 * Two facts live here and nowhere else. WHERE the head starts — one locator,
 * shared by every injector ON THIS PATH (the Bun build and a caller templating
 * its own shell; the Vite plugin injects through `transformIndexHtml`'s
 * `head-prepend` and structurally cannot come through here), so none of them can
 * drift into its own idea of it. And in what order the prelude is written: one
 * splice, stated once, rather than inferred from the order two calls happened to
 * be typed in — where swapping two adjacent lines would silently change the
 * shipped artifact. `injectShellCommit` is that same splice with nothing to
 * preload, so there is one code path, not two that must be kept in step.
 */

import { modulePreloadLinks } from "./modulePreload";

/** The global the no-store shell publishes the build commit on
 *  (`window.__SURFACE_APP_COMMIT__`). Build identity rides the SHELL, never a
 *  hashed `/assets/*` file: a commit stamped INSIDE the bundle rewrites the
 *  bytes of a file whose NAME — and so whose year-long `immutable` cache
 *  entry — doesn't change whenever two deploys differ only outside the client
 *  build (a docs-only commit), so every returning browser stays pinned on the
 *  old stamp, looks permanently stale, and the update prompt loops forever
 *  (kolu#1319). The shell is `no-store` — re-fetched on every load — so a
 *  commit carried here is always the deployed one, and the hashed bundle the
 *  shell names is paired with it by content, not by stamp. Read it via
 *  `shellCommit()` (`./lifecycle`). */
export const SHELL_COMMIT_GLOBAL = "__SURFACE_APP_COMMIT__";

/** The inline `<script>` that publishes `commit` on `SHELL_COMMIT_GLOBAL` —
 *  what `injectShellCommit` (and the `surfaceApp()` Vite plugin) puts in the
 *  shell, and what a Nix post-build stamp rewrites (kolu seds its placeholder
 *  in `dist/index.html` ONLY — never in `dist/assets/`). JSON-encoded with
 *  `<` escaped so an arbitrary commit string can't terminate the element. */
export function shellCommitScript(commit: string): string {
  return `<script>${shellCommitScriptBody(commit)}</script>`;
}

/** The inner text of `shellCommitScript` — `window.${SHELL_COMMIT_GLOBAL}=<literal>`,
 *  the `<script>`-less body both the Bun/Nix shell (via `shellCommitScript`) and
 *  the `/vite` plugin need. This is the ONE authoritative copy of the
 *  assignment shape and the `<`-escape that stops an arbitrary commit string
 *  from closing the element. `vite.ts` can't import it across Node's ESM
 *  boundary (see its header), so it carries a byte-identical inline copy that
 *  `vite.test.ts` pins to this function across adversarial commits. */
export function shellCommitScriptBody(commit: string): string {
  const literal = JSON.stringify(commit).replace(/</g, "\\u003c");
  return `window.${SHELL_COMMIT_GLOBAL}=${literal}`;
}

/** Inject the shell-commit script into an HTML shell, right after `<head>` so
 *  it runs before the module bundle reads it. Pure, and the path for a caller
 *  templating its own shell (`./client`'s note names it); the Bun builder goes
 *  through `injectShellHead` below, which writes this script and the preload
 *  links in one splice. The Vite path injects the same tag through
 *  `transformIndexHtml`. Throws when the template has no `<head>` rather than
 *  silently emitting a shell with no build identity. */
export function injectShellCommit(html: string, commit: string): string {
  return injectShellHead(html, { preloadHrefs: [], commit });
}

/** Everything this package puts in the shell's `<head>`, in the ONE order that
 *  is correct: the preload links FIRST — the point of the tags is to start those
 *  chunk fetches at the earliest byte the parser reaches, so nothing may push
 *  them later — then the build identity. Written in a single splice, so the
 *  order is stated here, once, instead of being the reverse of the order two
 *  injector calls happen to appear in.
 *
 *  No preload hrefs ⇒ no preload tags: a build whose entry split into nothing
 *  leaves no trace in the shell, rather than an empty artifact in every shell
 *  that never splits. */
export function injectShellHead(
  html: string,
  { preloadHrefs, commit }: { preloadHrefs: readonly string[]; commit: string },
): string {
  return insertAfterHead(
    html,
    modulePreloadLinks(preloadHrefs) + shellCommitScript(commit),
  );
}

/** Insert `snippet` right after the shell's `<head>` open tag — the ONE place
 *  anything is added to the head, so no injector can drift into its own idea of
 *  where the head starts. */
function insertAfterHead(html: string, snippet: string): string {
  // Require a real `head` start tag with a tag-name boundary — `<head>` or
  // `<head …>` but NOT `<header>`/`<headless>`. A loose `/<head[^>]*>/` would
  // match `<header>` and inject at the wrong spot, defeating the fail-loud
  // contract for a shell that has no real `<head>`.
  const head = /<head(?:\s|>)/i.exec(html);
  if (!head) {
    throw new Error(
      "@kolu/surface-app: the HTML template has no <head> — the shell would carry no build identity, and the entry's static chunks would cost an extra round trip on first paint",
    );
  }
  const close = html.indexOf(">", head.index);
  if (close === -1) {
    throw new Error(
      "@kolu/surface-app: the HTML template has an unterminated <head> tag",
    );
  }
  const at = close + 1;
  return html.slice(0, at) + snippet + html.slice(at);
}
