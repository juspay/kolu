import { shortenCwd } from "@kolu/terminal-vocab/terminalKey";
import type { TerminalMetadata } from "@kolu/padi-client/surface";

export interface PaneDirectory {
  root: string;
  rest: string;
  full: string;
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function paneDirectory(
  meta: TerminalMetadata | null,
): PaneDirectory | null {
  if (!meta) return null;
  const { cwd } = meta;
  const repoRoot = meta.git.kind === "repo" ? meta.git.info.repoRoot : null;
  if (repoRoot !== null && isUnder(cwd, repoRoot))
    return {
      root: shortenCwd(repoRoot),
      rest: cwd.slice(repoRoot.length),
      full: cwd,
    };
  return { root: shortenCwd(cwd), rest: "", full: cwd };
}
