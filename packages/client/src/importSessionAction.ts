/** Import-session command action — restore-parity for the W1 padi seam.
 *
 *  Before W1 the "Import session" command routed the picked blob through
 *  `session.handleRestoreSession`, which carried a re-entry guard and a
 *  `toast.loading → success/error` round-trip. The W1 recomposition (App.tsx)
 *  replaced that with a fire-and-forget `activePadiRpc.session.import`
 *  call: its rejection was unhandled (no error toast) and nothing stopped a
 *  second invoke while one was in flight — a double-invoke duplicates the
 *  restored terminals.
 *
 *  This restores both: a plain `inFlight` flag (a second call while one is in
 *  flight is a no-op) and the loading/success/error toast round-trip per
 *  `.claude/rules/toast-conventions.md` (loading toast + `{ id }` update for a
 *  slow op; the error toast ALWAYS carries `err.message`).
 *
 *  Extracted from App.tsx (rather than inlined) for two reasons: App.tsx is a
 *  thin layout shell whose reactive-primitive budget is capped
 *  (`App.shell.test.ts`), and it is deliberately un-importable under the node
 *  test runner — so the guard + toast semantics can only be unit-tested as a
 *  standalone unit. */

import type { SavedSession } from "@kolu/padi/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import type { UiAction } from "./runAction";

export function createImportSessionAction(deps: {
  /** Prompt for and validate the session blob (null when the user cancels or
   *  the file is malformed — malformed already surfaced its own toast). */
  pick: () => Effect.Effect<SavedSession | null>;
  /** Hand the picked blob to the host restore writer (the import RPC). */
  runImport: (args: {
    session: SavedSession;
  }) => Effect.Effect<unknown, unknown>;
}): () => UiAction {
  let inFlight = false;
  return () =>
    Effect.suspend(() => {
      // Re-entry guard: a second invoke while a pick/import is in flight is a
      // no-op. Set on the FORKING stack (`Effect.suspend`'s body runs there)
      // so a rapid double-invoke can't slip a duplicate import — and duplicate
      // terminals — past it.
      if (inFlight) return Effect.void;
      inFlight = true;
      return Effect.gen(function* () {
        const session = yield* deps.pick();
        if (!session) return;
        const id = toast.loading(
          `Importing ${session.terminals.length} terminals…`,
        );
        yield* deps.runImport({ session }).pipe(
          Effect.tap(() =>
            Effect.sync(() => toast.success("Session imported", { id })),
          ),
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(`Import failed: ${toError(err).message}`, { id });
            }),
          ),
        );
        // The `finally` of the old shape, and now total: a finalizer runs on
        // interruption too, so a dismissed picker never leaves the guard armed.
      }).pipe(Effect.ensuring(Effect.sync(() => (inFlight = false))));
    });
}
