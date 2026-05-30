/** Export / import of terminal session state as JSON.
 *
 *  A diagnostic backup/restore hatch for the same `SavedSession` blob that
 *  session restore consumes — snapshot session state to a file before a
 *  deploy, and re-import it if the server-persisted state is later lost or
 *  corrupted. Surfaced from the command palette's Debug group, not the
 *  primary flow.
 *
 *  Export serializes the current `SavedSession` to a download; import
 *  validates a picked file against `SavedSessionSchema` (the single source
 *  of truth — no hand-rolled guard) and hands it to `handleRestoreSession`,
 *  which recreates the terminals on top of whatever is already open. The
 *  JSON-parse/validation step is split out as `parseSavedSession` so it can
 *  be unit-tested without a DOM. */

import { type SavedSession, SavedSessionSchema } from "kolu-common/surface";
import { toast } from "solid-sonner";

const EXPORT_FILENAME = "kolu-session.json";

/** Download the saved session as a pretty-printed JSON file. No-op (with a
 *  toast) when there is nothing to export. */
export function exportSession(session: SavedSession | null): void {
  if (!session || session.terminals.length === 0) {
    toast.warning("No saved session to export");
    return;
  }
  const blob = new Blob([JSON.stringify(session, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  // Anchor-click download, mirroring `exportSessionAsHtml`'s fallback path.
  const a = document.createElement("a");
  a.href = url;
  a.download = EXPORT_FILENAME;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the download has had time to start (same delay as
  // `exportSessionAsHtml`); revoking synchronously can abort the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast.success(`Exported ${session.terminals.length} terminals`);
}

/** Parse + validate JSON text as a `SavedSession`, throwing an `Error` with
 *  a user-facing message on malformed input. Pure — no DOM, no toasts — so
 *  the validation path is unit-testable. */
export function parseSavedSession(text: string): SavedSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("file is not valid JSON");
  }
  const result = SavedSessionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("not a valid kolu session export");
  }
  return result.data;
}

/** Prompt for a JSON file, validate it, and hand the session to `restore`
 *  (which appends its terminals to the current canvas and reports its own
 *  progress). Pre-restore failures — dismissed picker excepted — surface as
 *  an error toast. */
export async function importSession(
  restore: (session: SavedSession) => Promise<void>,
): Promise<void> {
  let text: string | null;
  try {
    text = await pickJsonFile();
  } catch (err) {
    toast.error(`Import failed: ${(err as Error).message}`);
    return;
  }
  if (text === null) return; // picker dismissed
  let session: SavedSession;
  try {
    session = parseSavedSession(text);
  } catch (err) {
    toast.error(`Import failed: ${(err as Error).message}`);
    return;
  }
  await restore(session);
}

/** Resolve with the picked file's text, or null if the user dismisses the
 *  picker without choosing a file. */
function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then(resolve, () =>
          reject(new Error("could not read the selected file")),
        );
    });
    input.click();
  });
}
