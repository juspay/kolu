import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { Effect, type Scope } from "effect";
import { type PtyHostClient, ptyHostClientOver, ptyHostSurface } from "kaval";

export type PtyTuiClient = PtyHostClient;

export interface Connection {
  client: PtyTuiClient;
}

export function connectPtyHost(
  socketPath: string,
): Effect.Effect<Connection, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => unixSocketLink({ group: ptyHostSurface.group, socketPath }),
        catch: (err) => err,
      }),
      (link) => Effect.promise(() => link.dispose()),
    ),
    (link) => ({ client: ptyHostClientOver(link.dispatch) }),
  );
}
