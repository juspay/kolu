/** Trigger an HTML export of the active terminal's agent session.
 *
 *  Server reads the on-disk transcript (Claude JSONL / OpenCode SQLite /
 *  Codex JSONL), normalizes to the unified IR, renders either a lightweight
 *  chat log or a full collapsed transcript, and returns the string. We wrap it
 *  in a Blob and open/download it client-side — no server-side file write.
 *
 *  Distinct from `exportScrollbackAsPdf.ts` (which serializes xterm's
 *  ring buffer) by data source AND delivery: that one runs entirely on
 *  the client because the scrollback only exists there; this one runs
 *  on the server because the transcript only exists there. */

import type { TerminalId } from "kolu-common/surface";
import type { TranscriptHtmlMode } from "kolu-common/transcript";
import { toast } from "solid-sonner";
import { triggerDownload } from "./download";
import { client } from "./wire";

async function fetchHtml(id: TerminalId, mode: TranscriptHtmlMode) {
  return await client.terminal.exportTranscriptHtml({ id, mode });
}

function openExport(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  // Open in a new tab. The blob URL stays valid as long as this document is
  // alive; revoke after a generous delay so the new tab has time to fetch and
  // parse it.
  const win = window.open(url, "_blank", "noopener");
  if (!win) triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadExport(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportSessionAsHtml(
  id: TerminalId,
  modes: TranscriptHtmlMode[],
): Promise<void> {
  const [first, ...rest] = modes;
  if (first === undefined) throw new Error("No export modes requested");
  const multiple = rest.length > 0;
  const loadingId = toast.loading(
    multiple ? "Exporting session files…" : "Exporting session…",
  );
  try {
    if (multiple) {
      const exports = await Promise.all(
        modes.map((mode) => fetchHtml(id, mode)),
      );
      for (const { html, filename } of exports) downloadExport(html, filename);
      toast.success("Session files exported", { id: loadingId });
    } else {
      const { html, filename } = await fetchHtml(id, first);
      openExport(html, filename);
      toast.success(
        first === "chat" ? "Chat log exported" : "Full transcript exported",
        { id: loadingId },
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Failed to export session: ${message}`, { id: loadingId });
  }
}
