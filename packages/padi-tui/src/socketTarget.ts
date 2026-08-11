/**
 * WHICH local padi this face dials — `padi-tui`'s argv→socket step.
 *
 * Its own module, not a private function in `main.ts`, for the reason `create.ts`
 * and `exit.ts` are: `main.ts` is the CLI entry and exports nothing, so anything
 * living there is untestable without executing the command tree. This face's
 * socket resolution had no test at all while it hand-rolled its own refusals,
 * which is exactly how it drifted.
 *
 * Nothing here decides anything any more. Both halves are `@kolu/padi`'s:
 * `localPadiTargetOf` owns the FLAG refusals (blank before mutually-exclusive —
 * an order this face got backwards while it owned a copy), and `localPadiSocket`
 * owns the HOST ones (no daemon, or several with no primary). What is left is
 * the two-line adapter onto this CLI's error type.
 */

import { localPadiSocket, localPadiTargetOf } from "@kolu/padi/dial";
import { Effect } from "effect";
import { type CliFailure, failure } from "./exit.ts";

/** The two endpoint flags this face accepts, exactly as parsed off argv. */
export interface SocketFlags {
  readonly socket: string | undefined;
  readonly stateRoot: string | undefined;
}

/**
 * The socket to dial, or the refusal saying why none could be named.
 *
 * The selection policy (`--socket` wins; else `--state-root`; else
 * `$PADI_SOCKET`; else the sole running padi, or the PRIMARY one among several)
 * and EVERY refusal sentence live in the shared dial kit, so this face decides
 * nothing about wording and renders no candidate list of its own.
 *
 * It used to call the lower-level `resolveRunningPadiSocket` and hand-roll the
 * `many` sentence — the exact duplication `localPadiSocket`'s own docstring says
 * it exists to end, and it had already drifted: the local copy never mentioned
 * that `$PADI_SOCKET` picks a padi, so a `padi-tui` user was the one user never
 * told the easiest way out of the refusal. Worse, hand-rolling only the `many`
 * arm let `none` fall through to a success — a face that had found NO daemon
 * returned the merely-NAMED socket and dialed a path nothing serves, trading the
 * crafted "no running padi daemon found — start kolu" line for a raw connect
 * error. Delegating fixes both, and neither can come back: there is no second
 * sentence left to drift, and `unaddressable` is one arm.
 */
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
