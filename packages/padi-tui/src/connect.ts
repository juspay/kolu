import {
  connectPadi,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import { Effect, type Scope } from "effect";

export type PadiTuiClient = PadiSurfaceClient;

export function connectPadiTui(
  socketPath: string,
): Effect.Effect<PadiTuiClient, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(connectPadi(socketPath), (conn) =>
      Effect.sync(() => conn.dispose()),
    ),
    (conn) => scopePadiSurface(conn.client),
  );
}
