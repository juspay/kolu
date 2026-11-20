/**
 * A tui is a DIAL, never a supervisor (#1313): this reads the remote `hello` only
 * to GATE, and never drains / converges / recycles the remote padi — that is the
 * kolu-server binder's job (`server/src/padi/remotePadiBinding.ts`), never a CLI's.
 */
import { dialPadiViaHost } from "@kolu/padi/remote-dial";
import { Effect, type Scope } from "effect";
import type { Connection, PadiTuiClient } from "./connect.ts";

export function connectPadiTuiViaHost(
  host: string,
): Effect.Effect<Connection, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => dialPadiViaHost(host),
        catch: (err) => err,
      }),
      (dial) => Effect.sync(() => dial.dispose()),
    ),
    (dial) => ({
      client: dial.client as unknown as PadiTuiClient,
      localCwd: undefined,
    }),
  );
}
