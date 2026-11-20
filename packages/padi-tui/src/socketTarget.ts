import { localPadiSocket, localPadiTargetOf } from "@kolu/padi/stateRoot";
import { Effect } from "effect";
import { type CliFailure, failure } from "./exit.ts";

export interface SocketFlags {
  readonly socket: string | undefined;
  readonly stateRoot: string | undefined;
}

export function resolveSocketPath(
  flags: SocketFlags,
): Effect.Effect<string, CliFailure> {
  const target = localPadiTargetOf(flags);
  if (target.kind === "unaddressable") {
    return Effect.fail(failure(target.message));
  }
  return Effect.suspend(() => {
    const resolved = localPadiSocket(target.target);
    return resolved.kind === "ok"
      ? Effect.succeed(resolved.socket)
      : Effect.fail(failure(resolved.message));
  });
}
