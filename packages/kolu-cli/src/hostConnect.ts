import { dialPadiViaHost } from "@kolu/padi/remote-dial";
import { padiClientOver, scopePadiSurface } from "@kolu/padi-client/dial";
import { Effect } from "effect";
import {
  classifyDialFailure,
  type KoluCliConnection,
  type KoluCliDialError,
  PadiDialFailed,
  projectConnection,
} from "./connect.ts";

export function connectKoluCliViaHost(
  host: string,
): Effect.Effect<KoluCliConnection, KoluCliDialError> {
  return Effect.flatMap(
    Effect.tryPromise({
      try: () => dialPadiViaHost(host),
      catch: classifyDialFailure,
    }),
    (dial) => {
      if (dial.dispatch === undefined) {
        dial.dispose();
        return Effect.fail(
          new PadiDialFailed({
            message: `padi dial to ${host} returned no dispatch — the ssh link produced no addressable wire`,
            cause: undefined,
          }),
        );
      }
      return Effect.succeed(
        projectConnection({
          core: scopePadiSurface(padiClientOver(dial.dispatch)),
          dispose: dial.dispose,
          onClose: undefined,
        }),
      );
    },
  );
}
