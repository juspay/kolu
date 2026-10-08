/** The right panel's pane header line — which directory the shown pane is in.
 *
 *  A leaf: no SolidJS, no wire. `RightPanel` renders it, and its own unit test
 *  pins the one interesting decision — where the repo root ends and the path
 *  below it begins — so the component stays layout.
 *
 *  `shortenCwd` is the shared shortener (`@kolu/terminal-vocab/terminalKey`),
 *  the same one the dock row's label and the Inspector's directory row use:
 *  there is no second spelling of "how a path reads". */

import { shortenCwd } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalMetadata } from "@kolu/padi-client/surface";

export interface PaneDirectory {
  /** The `~`-shortened repo root — the directory the Code tree is browsed from
   *  — or the whole (shortened) cwd when the pane is in no repo. Rendered with
   *  emphasis. */
  root: string;
  /** The path below the root, unshortened (it never contains the home prefix).
   *  Rendered dimmed; empty when the pane sits AT its repo root. */
  rest: string;
  /** The raw cwd, for the line's `title`. */
  full: string;
}

/** `null` when there is no pane to describe. */
export function paneDirectory(
  meta: TerminalMetadata | null,
): PaneDirectory | null {
  if (!meta) return null;
  const { cwd } = meta;
  // Outside a repo, or before git resolves, the pane is described by its path.
  const repoRoot = meta.git.kind === "repo" ? meta.git.info.repoRoot : null;
  // The root is only a root if the pane is actually under it — a terminal whose
  // cwd left the repo (a `cd` ahead of the git sensor catching up) gets the
  // plain path rather than a highlighted prefix that is not where it lives.
  if (repoRoot !== null && (cwd === repoRoot || cwd.startsWith(`${repoRoot}/`)))
    return {
      root: shortenCwd(repoRoot),
      rest: cwd.slice(repoRoot.length),
      full: cwd,
    };
  return { root: shortenCwd(cwd), rest: "", full: cwd };
}
