/** Filesystem operations — thin server wrapper around kolu-fs. */

import type { FsListDirInput, FsListDirOutput } from "kolu-common";
import { listDir as fsListDir } from "kolu-fs";
import { getTerminal } from "./terminals.ts";
import { TerminalNotFoundError } from "kolu-common/errors";
import { log } from "./log.ts";

/**
 * List directory entries for a terminal's filesystem.
 * Resolves the terminal's repo root for the security boundary,
 * then delegates to kolu-fs.
 */
export async function listDir(input: FsListDirInput): Promise<FsListDirOutput> {
  const entry = getTerminal(input.terminalId);
  if (!entry) throw new TerminalNotFoundError(input.terminalId);

  const root = entry.info.meta.git?.repoRoot ?? entry.info.meta.cwd;

  const entries = await fsListDir({
    path: input.path,
    root,
    log,
  });

  return { entries };
}
