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

import {
  MODE_LABEL,
  type TranscriptHtmlMode,
} from "@kolu/padi-client/transcript";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { triggerDownload } from "./download";
import type { UiAction } from "./runAction";
import { activePadiRpc } from "./wire";

/** Own the object-URL lifecycle once: mint a blob URL for the document, hand
 *  it to a delivery strategy, and revoke after a generous delay so the new tab
 *  (or download) has time to fetch and parse it while this document is alive. */
function withBlobUrl(html: string, deliver: (url: string) => void): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  deliver(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openExport(html: string, filename: string): void {
  withBlobUrl(html, (url) => {
    // Open in a new tab; fall back to a download when the popup is blocked.
    const win = window.open(url, "_blank", "noopener");
    if (!win) triggerDownload(url, filename);
  });
}

function downloadExport(html: string, filename: string): void {
  withBlobUrl(html, (url) => triggerDownload(url, filename));
}

export function exportSessionAsHtml(
  id: TerminalId,
  modes: [TranscriptHtmlMode, ...TranscriptHtmlMode[]],
): UiAction {
  return Effect.gen(function* () {
    const [first, ...rest] = modes;
    const multiple = rest.length > 0;
    const loadingId = toast.loading(
      multiple ? "Exporting session files…" : "Exporting session…",
    );
    yield* Effect.gen(function* () {
      if (multiple) {
        // `Effect.all` over the modes, unbounded like the `Promise.all` it
        // replaces — the difference is that a failure now INTERRUPTS the
        // siblings instead of leaving them running into a rejected promise
        // nobody reads.
        const exports = yield* Effect.all(
          modes.map((mode) =>
            activePadiRpc.transcript.exportHtml({ id, mode }),
          ),
          { concurrency: "unbounded" },
        );
        for (const { html, filename } of exports)
          downloadExport(html, filename);
        toast.success("Session files exported", { id: loadingId });
        return;
      }
      const { html, filename } = yield* activePadiRpc.transcript.exportHtml({
        id,
        mode: first,
      });
      openExport(html, filename);
      toast.success(`${MODE_LABEL[first]} exported`, { id: loadingId });
    }).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(`Failed to export session: ${toError(err).message}`, {
            id: loadingId,
          });
        }),
      ),
    );
  });
}
