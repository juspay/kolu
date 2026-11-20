import { dialPadiViaHost } from "@kolu/padi/remote-dial";
import { Effect, type Scope } from "effect";
import type { PadiTuiClient } from "./connect.ts";

export function connectPadiTuiViaHost(
  host: string,
): Effect.Effect<PadiTuiClient, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => dialPadiViaHost(host),
        catch: (err) => err,
      }),
      (dial) => Effect.sync(() => dial.dispose()),
    ),
    (dial) => dial.client as unknown as PadiTuiClient,
  );
}
