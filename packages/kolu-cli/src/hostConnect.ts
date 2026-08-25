/**
 * `kolu mcp --host <ssh>` — reach a padi on a remote machine over ssh and hand
 * back a `KoluCliConnection` of the SAME shape the local dial returns, so the
 * MCP face is transport-blind. Padi's client dial kit owns the one-shot recipe
 * shared with padi-tui: select padi from the exact baked source for the host's
 * architecture, provision and root it through the target Nix store, then run
 * `ssh <host> padi --stdio`, and speak the COMBINED `padiDaemonContract` over
 * that child's stdio. padi's `--stdio` mode fronts the *durable* daemon, so a
 * terminal a remote create spawns — and its kaval and PTYs — outlives the ssh
 * link.
 *
 * Like padi-tui, the `probe` is a protocol assertion beyond liveness: read the
 * remote padi's `identity` and run the shared `assertPadiSurfaceCompatible` —
 * the SAME skew judgement the local `connectPadi` applies — so a remote padi too
 * new for this build (or a kolu too old) fails LOUD with the same honest
 * "upgrade" line. A dial NEVER drains/converges the remote padi (#1313) — that
 * is the kolu-server binder's job.
 *
 * The face is rebuilt from the dial's tag-keyed DISPATCH rather than taken off
 * `dial.client`. `dialAgentOnce` is surface-generic, so the face it hands back
 * is the erased structural `SurfaceFace` (D2/#16 puts per-member precision in
 * spec-derived faces, not in the connector); `padiClientOver` re-derives both of
 * padi's sibling faces from padi's OWN surface values over that same wire. Same
 * bytes, no cast, and the tags can only agree with what the daemon serves.
 */

import { dialPadiViaHost } from "@kolu/padi/remote-dial";
import { padiClientOver, scopePadiSurface } from "@kolu/padi-client/dial";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect } from "effect";
import {
  classifyDialFailure,
  type KoluCliConnection,
  type KoluCliDialError,
  PadiDialFailed,
} from "./connect.ts";

/** Project a dialed `AgentDial` onto the face-visible {@link KoluCliConnection}.
 *  The mirror of `connect.ts`'s `koluCliConnectionOf`, named for the same
 *  reason: the two arms must be readable side by side, and a field one carries
 *  and the other does not must be VISIBLE as such rather than silently absent
 *  from an inline literal. The literal that dropped `onClose` without saying so
 *  was juspay/kolu#2082. */
function koluCliConnectionOfAgentDial(
  dispatch: SurfaceDispatch,
  dispose: () => void,
): KoluCliConnection {
  return {
    client: scopePadiSurface(padiClientOver(dispatch)),
    dispose,
    // NO close announcement, stated rather than omitted. `AgentDial` carries no
    // close-shaped field, so there is nothing here to pass on — even though the
    // ssh layer below DOES observe its child's exit (`sshConnector`'s
    // `ClosedInfo`, surfaced per attempt as `Connection.closed`). The gap is the
    // dial's face, not the transport; until it projects one, the MCP adapter
    // falls back to its lazy catch-side reset, so a remote padi restart still
    // costs the first call after it. Wiring the projection is the follow-up, and
    // this line is where it lands.
    onClose: undefined,
  };
}

/** Dial a padi on `host` over ssh, one-shot: provision, run `padi --stdio`,
 *  gate the padiSurface contract version, scope to padi's sibling face. All
 *  diagnostics ride stderr (dialAgentOnce's default sink) — stdout is the MCP
 *  protocol channel and must never carry a log line.
 *
 *  Fails with the SAME tagged alphabet the local dial does
 *  ({@link KoluCliDialError}), classified by the same `classifyDialFailure`, so
 *  the MCP face's skew-vs-transport policy is written once and a face stays
 *  transport-blind on the failure side too — not only on the success side. */
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
        // `AgentDial.dispatch` is optional because it is a property of the
        // TRANSPORT, not of the dial role — but every `sshConnector` dial
        // supplies one, so its absence is a broken link, not a mode to degrade
        // into. Fail loud here rather than hand the MCP face a client that
        // cannot address padi.
        dial.dispose();
        return Effect.fail(
          new PadiDialFailed({
            message: `padi dial to ${host} returned no dispatch — the ssh link produced no addressable wire`,
            cause: undefined,
          }),
        );
      }
      return Effect.succeed(
        koluCliConnectionOfAgentDial(dial.dispatch, dial.dispose),
      );
    },
  );
}
