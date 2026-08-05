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

import {
  backfillSavedSession,
  type SavedSession,
  SavedSessionSchema,
} from "@kolu/padi/surface";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { toError } from "@kolu/surface/run-stream";
import { Cause, Effect, Result, Schema } from "effect";
import { toast } from "solid-sonner";
import { triggerDownload } from "./download";

const EXPORT_FILENAME = "kolu-session.json";

/** zod's `safeParse` in Effect terms — a `Result`, because a malformed import is
 *  a user-facing REJECTION with its own message, not a crash. */
const decodeSavedSession = Schema.decodeUnknownResult(SavedSessionSchema);

/** Download the saved session as a pretty-printed JSON file. No-op (with a
 *  toast) when there is nothing to export. */
export function exportSession(session: SavedSession | null): void {
  if (!session || session.terminals.length === 0) {
    toast.warning("No saved session to export");
    return;
  }
  // Disk shape only — strip wire-only host stamp so the backup matches conf.
  const { resumableIds: _wireOnly, ...disk } = session;
  const blob = new Blob([JSON.stringify(disk, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, EXPORT_FILENAME);
  // Revoke after the download has had time to start (same delay as
  // `exportSessionAsHtml`); revoking synchronously can abort the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast.success(`Exported ${session.terminals.length} terminals`);
}

/** The largest session export `session.import` will carry (juspay/kolu#2101
 *  G9a sweep).
 *
 *  `session.import` is the only client→server member besides `scratch.write`
 *  whose payload is user-authored, and that direction is the dangerous one: an
 *  oversized frame client→server does not fail the call, it closes the socket
 *  (1009) and takes every subscription on the tab with it. A session file is
 *  realistically tens of KB — a few hundred terminals of short strings — but
 *  the file comes off the user's disk and nothing stopped a hand-crafted one
 *  from being megabytes.
 *
 *  Unlike an upload, chunking this is wrong: the session decodes as ONE value,
 *  so half of it is not a smaller session. A cap with an honest message is the
 *  right shape. Set at a quarter of the wire's frame budget, which is ~4 MiB —
 *  two orders of magnitude above any real export, so it can only ever fire on
 *  something already broken, and it fires here rather than on the socket. */
const MAX_SESSION_IMPORT_BYTES = RPC_MAX_FRAME_BYTES / 4;

/** Parse + validate JSON text as a `SavedSession`, throwing an `Error` with
 *  a user-facing message on malformed input. Pure — no DOM, no toasts — so
 *  the validation path is unit-testable.
 *
 *  An exported `kolu-session.json` is a snapshot of the same on-disk shape the
 *  server's migration ladder upgrades — so a backup taken before a schema bump
 *  (no `state`/`location`/`remoteUrl`) must get the SAME backfill the ladder
 *  applies, or this recovery hatch can't recover the very backups it exists for.
 *  `backfillSavedSession` runs those exact field backfills (the single source of
 *  truth shared with `state.ts`) before validation; the discriminated
 *  `SavedSessionSchema` then rejects anything still malformed.
 *
 *  #17 note — an explicit-`undefined` key is NOT decodable under Effect Schema
 *  (`optionalKey`/`withDecodingDefaultKey` accept an ABSENT key, never a present
 *  `undefined` one), so an in-process caller must never hand one in. This path
 *  cannot: its input is `JSON.parse` output, where `undefined` is unrepresentable,
 *  and every backfill above ADDS keys with defined values or passes the record
 *  through untouched. So there is nothing to strip — stated rather than guarded,
 *  because a strip pass here would be dead code pretending to hold a line the
 *  input shape already holds. */
export function parseSavedSession(text: string): SavedSession {
  // Measured BEFORE `JSON.parse` — parsing a huge string is the cost we are
  // avoiding, and the size we care about is the one that would ride the wire.
  // `text.length` is UTF-16 code units, which is exactly what the ndjson
  // decoder counts, so the two measure the same thing.
  if (text.length > MAX_SESSION_IMPORT_BYTES) {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
    throw new Error(
      `that session file is ${mb(text.length)} MB; the limit is ${mb(MAX_SESSION_IMPORT_BYTES)} MB. A real kolu export is a few hundred KB at most, so this one is very likely not a session export.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("file is not valid JSON");
  }
  const result = decodeSavedSession(backfillSavedSession(parsed));
  if (Result.isFailure(result)) {
    throw new Error("not a valid kolu session export");
  }
  return result.success;
}

/** Prompt for a JSON file and answer with the validated session, or null if the
 *  user dismisses the picker or the file is malformed (errors surface as a
 *  toast). The caller owns restoring it — keeping the restore call out of
 *  here means restore failures are handled at the call site rather than
 *  swallowed. */
export function importSession(): Effect.Effect<SavedSession | null> {
  return pickJsonFile().pipe(
    Effect.map((text) =>
      // picker dismissed
      text === null ? null : parseSavedSession(text),
    ),
    // `catchCause`, not `catch`: `parseSavedSession` THROWS its user-facing
    // message (it is a pure function shared with the unit tests), so inside an
    // effect that message arrives as a DEFECT, and a plain error-channel
    // recovery would miss it — the import would die instead of toasting.
    Effect.catchCause((cause) =>
      Effect.sync((): SavedSession | null => {
        toast.error(`Import failed: ${toError(Cause.squash(cause)).message}`);
        return null;
      }),
    ),
  );
}

/** The picked file's text, or null if the user dismisses the picker without
 *  choosing a file.
 *
 *  `Effect.callback` over the file input's two terminal events. The hazard the
 *  old `new Promise` documented is structural here: `resume` is idempotent, so
 *  the `cancel` listener that keeps a dismissed picker from hanging forever
 *  cannot double-settle against `change`. */
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
