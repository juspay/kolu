/**
 * `kolu mcp --host <ssh>` — reach a padi on a remote machine over ssh and hand
 * back a `KoluCliConnection` of the SAME shape the local dial returns, so the
 * MCP face is transport-blind. Padi's client dial kit owns the one-shot recipe
 * shared with padi-tui: resolve padi's
 * `.drv` for the host's arch, ship it (`nix copy` → realise), run
 * `ssh <host> padi --stdio`, and speak the COMBINED `padiDaemonContract` over
 * that child's stdio. padi's `--stdio` mode fronts the *durable* daemon, so a
 * terminal a remote create spawns — and its kaval and PTYs — outlives the ssh
 * link.
 *
 * Like padi-tui, the `probe` is a protocol assertion beyond liveness: read the
 * frozen control core's `hello` and run the shared
 * `assertPadiSurfaceCompatible` — the SAME skew judgement the local
 * `connectPadi` applies — so a remote padi too new for this build (or a kolu
 * too old) fails LOUD with the same honest "upgrade" line. A dial NEVER
 * drains/converges the remote padi (#1313) — that is the kolu-server binder's
 * job.
 */

import { dialPadiViaHost, scopePadiSurface } from "@kolu/padi/dial";
import { type KoluCliConnection, mountStreamRetry } from "./connect.ts";

/** Dial a padi on `host` over ssh, one-shot: provision, run `padi --stdio`,
 *  gate the padiSurface contract version, scope + mount retry. All diagnostics
 *  ride stderr (dialAgentOnce's default sink) — stdout is the MCP protocol
 *  channel and must never carry a log line. */
export async function connectKoluCliViaHost(
  host: string,
): Promise<KoluCliConnection> {
  const dial = await dialPadiViaHost(host);
  return {
    client: mountStreamRetry(scopePadiSurface(dial.client)),
    dispose: dial.dispose,
  };
}
