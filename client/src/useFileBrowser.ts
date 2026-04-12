/**
 * File browser + right panel state — shared singleton.
 *
 * The right panel hosts Files, Changes, Peek, Diff, and Claude Transcript
 * views inline. State here drives which view is active and what content
 * is displayed. The panel itself is resizable via Corvu in the layout.
 */

import { createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "./rpc";
import type { FsReadFileOutput } from "kolu-common";

/** Which view the right panel is showing. */
export type RightPanelView =
  | "files"
  | "changes"
  | "peek"
  | "diff"
  | "transcript";

// Singleton state
const [fileSearchOpen, setFileSearchOpen] = createSignal(false);
const [rightPanelOpen, setRightPanelOpen] = createSignal(false);
const [rightPanelView, setRightPanelView] =
  createSignal<RightPanelView>("files");

// Peek state
const [peekFile, setPeekFile] = createSignal<{
  path: string;
  root: string;
  content: FsReadFileOutput;
} | null>(null);

// Diff state
const [diffTarget, setDiffTarget] = createSignal<{
  root: string;
  filePath: string;
} | null>(null);

export function useFileBrowser() {
  function toggleRightPanel(): void {
    setRightPanelOpen((v) => !v);
  }

  /** Open the right panel to a specific view. */
  function showView(view: RightPanelView): void {
    setRightPanelView(view);
    setRightPanelOpen(true);
  }

  async function openPeek(root: string, filePath: string): Promise<void> {
    try {
      const content = await client.fs.readFile({ root, filePath });
      setPeekFile({ path: filePath, root, content });
      showView("peek");
    } catch (err: unknown) {
      toast.error(
        `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  function openDiff(root: string, filePath: string): void {
    setDiffTarget({ root, filePath });
    showView("diff");
  }

  function openTranscript(): void {
    showView("transcript");
  }

  /** Navigate back from peek/diff to the previous list view. */
  function goBack(): void {
    const view = rightPanelView();
    if (view === "peek" || view === "diff") {
      setPeekFile(null);
      setDiffTarget(null);
      setRightPanelView("files");
    }
  }

  return {
    fileSearchOpen,
    setFileSearchOpen,
    rightPanelOpen,
    setRightPanelOpen,
    rightPanelView,
    setRightPanelView,
    toggleRightPanel,
    showView,
    peekFile,
    diffTarget,
    openPeek,
    openDiff,
    openTranscript,
    goBack,
  } as const;
}
