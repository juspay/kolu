import {
  connectPadi,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import { Effect, type Scope } from "effect";

export type PadiTuiClient = PadiSurfaceClient;

export interface Connection {
  client: PadiTuiClient;
  localCwd: string | undefined;
}

export function connectPadiTui(
  socketPath: string,
): Effect.Effect<Connection, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(connectPadi(socketPath), (conn) =>
      Effect.sync(() => conn.dispose()),
    ),
    (conn) => ({
      client: scopePadiSurface(conn.client),
      localCwd: process.cwd(),
    }),
  );
}
