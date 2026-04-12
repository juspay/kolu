/**
 * File browser state — shared between FileSearch (palette) and FileTree (sidebar).
 * Scoped to the active terminal's workspace root. Queries are server-driven.
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

  return {
    fileSearchOpen,
    setFileSearchOpen,
    filePeekOpen,
    peekFile,
    openPeek,
    closePeek,
  } as const;
}
