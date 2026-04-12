/**
 * File browser state — shared between FileSearch (palette), FileTree (sidebar),
 * GitChanges (sidebar), and DiffModal. Queries are server-driven.
 */

import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "./rpc";
import type { FsReadFileOutput } from "kolu-common";

// Singleton state — created once, used by all consumers.
const [fileSearchOpen, setFileSearchOpen] = createSignal(false);
const [filePeekOpen, setFilePeekOpen] = createSignal(false);
const [peekFile, setPeekFile] = createSignal<{
  path: string;
  content: FsReadFileOutput;
} | null>(null);
const [diffOpen, setDiffOpen] = createSignal(false);
const [diffTarget, setDiffTarget] = createSignal<{
  root: string;
  filePath: string;
} | null>(null);

export function useFileBrowser() {
  async function openPeek(root: string, filePath: string): Promise<void> {
    try {
      const content = await client.fs.readFile({ root, filePath });
      setPeekFile({ path: filePath, content });
      setFilePeekOpen(true);
    } catch (err: unknown) {
      toast.error(
        `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function closePeek(): void {
    setFilePeekOpen(false);
    setPeekFile(null);
  }

  function openDiff(root: string, filePath: string): void {
    setDiffTarget({ root, filePath });
    setDiffOpen(true);
  }

  function closeDiff(): void {
    setDiffOpen(false);
    setDiffTarget(null);
  }

  return {
    fileSearchOpen,
    setFileSearchOpen,
    filePeekOpen,
    peekFile,
    openPeek,
    closePeek,
    diffOpen,
    diffTarget,
    openDiff,
    closeDiff,
  } as const;
}
