/** Trigger an HTML export of the active terminal's agent session.
 *
 *  Server reads the on-disk transcript (Claude JSONL / OpenCode SQLite /
 *  Codex JSONL), normalizes to the unified IR, renders to a self-
 *  contained HTML document, and returns the string. We wrap it in a
 *  Blob and open in a new tab — no `window.print()`, no popup-and-save
 *  dance like `exportScrollbackAsPdf`. The user can save the page as a
 *  file via the browser's native menu.
 *
 *  Distinct from `exportScrollbackAsPdf.ts` (which serializes xterm's
 *  ring buffer) by data source AND delivery: that one runs entirely on
 *  the client because the scrollback only exists there; this one runs
 *  on the server because the transcript only exists there. */

import type { TerminalId } from "kolu-common";
import { toast } from "solid-sonner";
import { client } from "./rpc/rpc";

export async function exportSessionAsHtml(id: TerminalId): Promise<void> {
  const loadingId = toast.loading("Exporting session…");
  try {
    const { html, filename } = await client.terminal.exportTranscriptHtml({
      id,
    });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    // Open in a new tab. The blob URL stays valid as long as this
    // document is alive; revoke after a generous delay so the new tab
    // has time to fetch and parse it.
    const win = window.open(url, "_blank", "noopener");
    if (!win) {
      // Popup blocked — fall back to a download via an anchor click. Same
      // origin (blob:) and no user-supplied content in the path so this
      // is safe.
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast.success("Session exported", { id: loadingId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Failed to export session: ${message}`, { id: loadingId });
  }
}
