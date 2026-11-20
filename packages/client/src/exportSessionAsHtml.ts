import { MODE_LABEL, type TranscriptHtmlMode } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { triggerDownload } from "./download";
import type { UiAction } from "./runAction";
import { activePadiRpc } from "./wire";

function withBlobUrl(html: string, deliver: (url: string) => void): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  deliver(url);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function openExport(html: string, filename: string): void {
  withBlobUrl(html, (url) => {
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
