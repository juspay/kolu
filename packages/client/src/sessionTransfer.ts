import { formatMiB } from "@kolu/byte-units";
import {
  backfillSavedSession,
  type SavedSession,
  SavedSessionSchema,
} from "@kolu/padi-client/surface";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { toError } from "@kolu/surface/run-stream";
import { Effect, Result, Schema } from "effect";
import { toast } from "solid-sonner";
import { triggerDownload } from "./download";

const EXPORT_FILENAME = "kolu-session.json";

const decodeSavedSession = Schema.decodeUnknownResult(SavedSessionSchema);

export function exportSession(session: SavedSession | null): void {
  if (!session || session.terminals.length === 0) {
    toast.warning("No saved session to export");
    return;
  }
  const { resumableIds: _wireOnly, ...disk } = session;
  const blob = new Blob([JSON.stringify(disk, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, EXPORT_FILENAME);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast.success(`Exported ${session.terminals.length} terminals`);
}

const MAX_SESSION_IMPORT_BYTES = RPC_MAX_FRAME_BYTES / 4;

export function parseSavedSession(
  text: string,
): Result.Result<SavedSession, string> {
  if (text.length > MAX_SESSION_IMPORT_BYTES) {
    return Result.fail(
      `that session file is ${formatMiB(text.length, 1)}; the limit is ${formatMiB(MAX_SESSION_IMPORT_BYTES, 1)}. A real kolu export is a few hundred KiB at most, so this one is very likely not a session export.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Result.fail("file is not valid JSON");
  }
  const decoded = decodeSavedSession(backfillSavedSession(parsed));
  if (Result.isFailure(decoded)) {
    return Result.fail("not a valid kolu session export");
  }
  return Result.succeed(decoded.success);
}

export function importSession(): Effect.Effect<SavedSession | null> {
  return Effect.gen(function* () {
    const picked = yield* Effect.result(pickJsonFile());
    if (Result.isFailure(picked)) {
      toast.error(`Import failed: ${toError(picked.failure).message}`);
      return null;
    }
    const text = picked.success;
    if (text === null) return null;
    const session = parseSavedSession(text);
    if (Result.isFailure(session)) {
      toast.error(`Import failed: ${session.failure}`);
      return null;
    }
    return session.success;
  });
}

function pickJsonFile(): Effect.Effect<string | null, Error> {
  return Effect.callback<string | null, Error>((resume) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    // Dismissing the picker fires `cancel`, not `change`, in modern browsers —
    // without this listener `change` never fires and the read never settles.
    input.addEventListener("cancel", () => resume(Effect.succeed(null)));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resume(Effect.succeed(null));
        return;
      }
      resume(
        Effect.tryPromise({
          try: () => file.text(),
          catch: () => new Error("could not read the selected file"),
        }),
      );
    });
    input.click();
  });
}
