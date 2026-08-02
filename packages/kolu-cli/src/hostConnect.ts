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

import {
  dialPadiViaHost,
  padiClientOver,
  scopePadiSurface,
} from "@kolu/padi/dial";
import type { KoluCliConnection } from "./connect.ts";

/** Dial a padi on `host` over ssh, one-shot: provision, run `padi --stdio`,
 *  gate the padiSurface contract version, scope to padi's sibling face. All
 *  diagnostics ride stderr (dialAgentOnce's default sink) — stdout is the MCP
 *  protocol channel and must never carry a log line. */
export async function connectKoluCliViaHost(
  host: string,
): Promise<KoluCliConnection> {
  const dial = await dialPadiViaHost(host);
  if (dial.dispatch === undefined) {
    // `AgentDial.dispatch` is optional because it is a property of the
    // TRANSPORT, not of the dial role — but every `sshConnector` dial supplies
    // one, so its absence is a broken link, not a mode to degrade into. Fail
    // loud here rather than hand the MCP face a client that cannot address padi.
    dial.dispose();
    throw new Error(
      `padi dial to ${host} returned no dispatch — the ssh link produced no addressable wire`,
    );
  }
  return {
    client: scopePadiSurface(padiClientOver(dial.dispatch)),
    dispose: dial.dispose,
  };
}
