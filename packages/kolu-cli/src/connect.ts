import { type LocalPadiTarget, localPadiSocket } from "@kolu/padi/stateRoot";
import {
  connectPadi,
  type PadiConnection,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import { isContractSkewError } from "@kolu/surface-daemon-supervisor";
import { Data, Effect } from "effect";
import type { KoluMcpConnection } from "kolu-mcp";
import { errorMessage } from "./exit.ts";

export type KoluCliConnection = KoluMcpConnection;

export class PadiNotAddressable extends Data.TaggedError("PadiNotAddressable")<{
  readonly message: string;
}> {}

export class PadiContractSkew extends Data.TaggedError("PadiContractSkew")<{
  readonly message: string;
}> {}

export class PadiDialFailed extends Data.TaggedError("PadiDialFailed")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export type KoluCliDialError =
  | PadiNotAddressable
  | PadiContractSkew
  | PadiDialFailed;

export function classifyDialFailure(
  err: unknown,
): PadiContractSkew | PadiDialFailed {
  if (isContractSkewError(err)) {
    return new PadiContractSkew({ message: err.message });
  }
  return new PadiDialFailed({ message: errorMessage(err), cause: err });
}

export function connectKoluCliLocal(
  target: LocalPadiTarget,
): Effect.Effect<KoluCliConnection, KoluCliDialError> {
  return Effect.suspend<KoluCliConnection, KoluCliDialError, never>(() => {
    const resolved = localPadiSocket(target);
    if (resolved.kind === "unaddressable") {
      return Effect.fail(new PadiNotAddressable({ message: resolved.message }));
    }
    return Effect.map(
      Effect.mapError(connectPadi(resolved.socket), classifyDialFailure),
      koluCliConnectionOf,
    );
  });
}

export function projectConnection(parts: {
  readonly core: PadiSurfaceClient;
  readonly dispose: () => void | Promise<void>;
  readonly onClose: ((cb: () => void) => void) | undefined;
}): KoluCliConnection {
  return {
    client: { core: parts.core },
    dispose: parts.dispose,
    onClose: parts.onClose,
  };
}

export function koluCliConnectionOf(conn: PadiConnection): KoluCliConnection {
  return projectConnection({
    core: scopePadiSurface(conn.client),
    dispose: () => conn.dispose(),
    onClose: (cb) => conn.onClose(cb),
  });
}
