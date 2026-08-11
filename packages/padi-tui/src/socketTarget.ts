/**
 * WHICH local padi this face dials — `padi-tui`'s argv→socket step.
 *
 * Its own module, not a private function in `main.ts`, for the reason
 * `create.ts` and `exit.ts` are: `main.ts` is the CLI entry and exports nothing,
 * so anything living there is untestable without executing the command tree. The
 * refusals below are user-visible contract — one of them exists precisely
 * because a silent fall-through was not caught by a test — so they are pinned by
 * `socketTarget.test.ts` rather than trusted.
 */

import { type LocalPadiTarget, localPadiSocket } from "@kolu/padi/dial";
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
 * and BOTH refusal sentences live in the shared `localPadiSocket` (the dial
 * kit), so this face decides nothing about wording and renders no candidate list
 * of its own.
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
  if (flags.socket !== undefined && flags.stateRoot !== undefined) {
    return Effect.fail(
      failure(
        "--socket and --state-root are mutually exclusive: --socket is a literal socket path, --state-root derives one. Pass just one.",
      ),
    );
  }
  // A flag that is PRESENT but blank is refused, and the primary rule is what
  // makes that urgent rather than tidy. `--socket "$SOCK"` with `$SOCK` unset is
  // an ordinary shell accident; the resolver treats `""` as "no socket given",
  // so it falls through to discovery — which now RESOLVES on a multi-daemon host
  // instead of refusing. The user who named one padi would silently drive the
  // primary one's terminals: the very wrong-workspace drive the primary rule
  // elsewhere refuses to risk. Whitespace counts as blank for the same reason
  // (`--socket " "` is the same accident with a quoted space). kolu-cli's
  // `endpointOf` states the identical rule for the identical reason; the two
  // stay separate only because padi-tui does not depend on kolu-cli.
  const blank = (
    [
      ["--socket", flags.socket],
      ["--state-root", flags.stateRoot],
    ] as const
  )
    .filter(([, v]) => v !== undefined && v.trim() === "")
    .map(([name]) => name);
  if (blank.length > 0) {
    return Effect.fail(
      failure(
        `${blank.join(" and ")} was passed with an empty value — an unset shell variable, most likely. Name a padi, or drop the flag entirely; padi-tui will not quietly fall back to whichever daemon it discovers.`,
      ),
    );
  }
  const target: LocalPadiTarget =
    flags.socket !== undefined
      ? { kind: "socket", path: flags.socket }
      : flags.stateRoot !== undefined
        ? { kind: "stateRoot", dir: flags.stateRoot }
        : { kind: "auto" };
  return Effect.suspend(() => {
    const resolved = localPadiSocket(target);
    return resolved.kind === "ok"
      ? Effect.succeed(resolved.socket)
      : Effect.fail(failure(resolved.message));
  });
}
