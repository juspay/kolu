/** Kolu's binding for Markdown image `src` resolution: take the
 *  host-agnostic GitHub-relative path resolution from `@kolu/solid-browser`
 *  and wrap the result into a per-terminal file-route URL the browser can
 *  fetch, so a README's `![](docs/logo.png)` renders the real image instead of
 *  degrading to a fallback chip.
 *
 *  The relative-path rules (resolve against the doc's directory, root-absolute
 *  from the repo root, reject own-scheme refs and `..`-escape) live in
 *  `@kolu/solid-browser`'s `resolveRelativePath` — shared with the link path
 *  (`resolveLinkHref`) that the Code-tab front door opens. Only the kolu
 *  volatility — the file-route URL contract — stays here. */

import { resolveRelativePath } from "@kolu/solid-browser";
import { buildTerminalFileUrl } from "kolu-common/preview";

/** Resolve a repo-relative image `src` to a per-terminal file-route URL the
 *  browser can fetch. Returns `undefined` when `src` carries its own
 *  origin/scheme or escapes the repo root. */
export function resolveMarkdownImageSrc(
  terminalId: string,
  markdownFilePath: string,
  src: string,
): string | undefined {
  const repoRel = resolveRelativePath(markdownFilePath, src);
  if (repoRel === null) return undefined;
  return buildTerminalFileUrl(terminalId, repoRel);
}
