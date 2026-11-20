import type { SavedSession } from "@kolu/padi-client/surface";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { toast } from "solid-sonner";
import type { UiAction } from "./runAction";

export function createImportSessionAction(deps: {
  pick: () => Effect.Effect<SavedSession | null>;
  runImport: (args: {
    session: SavedSession;
  }) => Effect.Effect<unknown, unknown>;
}): () => UiAction {
  let inFlight = false;
  return () =>
    Effect.suspend(() => {
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
      }).pipe(Effect.ensuring(Effect.sync(() => (inFlight = false))));
    });
}
