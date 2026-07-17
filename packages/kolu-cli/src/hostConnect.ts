/**
 * `kolu mcp --host <ssh>` — reach a padi on a remote machine over ssh and hand
 * back a `KoluCliConnection` of the SAME shape the local dial returns, so the
 * MCP face is transport-blind. The thin options literal over
 * `@kolu/surface-remote`'s `dialAgentOnce` — the same one-shot composition
 * padi-tui's and kaval-tui's `hostConnect.ts` wrappers ride: resolve padi's
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
 *
 * This is the only place kolu-cli imports `@kolu/surface-remote`.
 *
 * RECORDED EXTRACTION (kolu-cli plan footnote + #1865 a-f-p C3): the
 * `dialAgentOnce` options literal + the hello/compat `probe` below are now a
 * VERBATIM twin of `padi-tui/src/hostConnect.ts` — both spell padi's remote-dial
 * recipe (binary `padi`, `PADI_AGENT_DRVS_JSON`, `drvNoun`, `fatalPrefix`
 * `padi --stdio:`, the `hello → assertPadiSurfaceCompatible` probe). The plan
 * deferred lifting a shared `connectPadiViaHost` ("compose in-app, extract only
 * if a byte-identical twin actually emerges"); the twin has now emerged, so the
 * gate is met — a `dialPadiViaHost(host)` belongs in `@kolu/padi/dial` (the
 * client-only dial kit, already excluded from padi's daemon closure), with
 * padi-tui grafting its `localCwd` and kolu-cli its `mountStreamRetry` around the
 * shared dial. Deferred to a follow-up (it adds a padi→surface-remote client edge
 * that wants its own hash/seal pass), NOT this PR — recorded here so the next
 * touch of either wrapper does the lift rather than deepening the fork.
 */

import { assertPadiSurfaceCompatible, scopePadiSurface } from "@kolu/padi/dial";
import type { PadiDaemonContract } from "@kolu/padi/surface";
import { dialAgentOnce } from "@kolu/surface-remote";
import { composeSpawnEnv } from "kolu-pty";
import { type KoluCliConnection, mountStreamRetry } from "./connect.ts";

/** The per-system `{ system → padi .drv }` map env var, baked onto koluBin
 *  (default.nix) — the SAME map the server's remote binding and padi-tui's
 *  wrapper read. Named ONCE so the literal passed to `dialAgentOnce` (for its
 *  errors) and the `process.env[…]` read can't drift apart. */
const PADI_AGENT_DRVS_ENV = "PADI_AGENT_DRVS_JSON";

/** Dial a padi on `host` over ssh, one-shot: provision, run `padi --stdio`,
 *  gate the padiSurface contract version, scope + mount retry. All diagnostics
 *  ride stderr (dialAgentOnce's default sink) — stdout is the MCP protocol
 *  channel and must never carry a log line. */
export async function connectKoluCliViaHost(
  host: string,
): Promise<KoluCliConnection> {
  const dial = await dialAgentOnce<PadiDaemonContract>({
    host,
    // localhost spawn env: clean allowlist via kolu-pty's composeSpawnEnv; see the localEnv doc on buildAgentCommand.
    localEnv: composeSpawnEnv(process.env),
    // `${agentPath}/bin/padi`, run as `padi --stdio`. The connector appends
    // `--stdio` itself, so it is NEVER added here (F2 in remotePadiBinding).
    binary: "padi",
    envVar: PADI_AGENT_DRVS_ENV,
    agentDrvsJson: process.env[PADI_AGENT_DRVS_ENV],
    drvNoun: "padi",
    // The remote runs `padi --stdio`, whose fatal prefix is `padi --stdio:`
    // (NOT `padi:` — see padi/src/stdioBridge.ts + bin.ts), so the dial
    // surfaces the remote's own reason instead of an opaque "stream closed".
    fatalPrefix: "padi --stdio:",
    probe: async (client) => {
      const hello = await client.surface.control.core.hello();
      assertPadiSurfaceCompatible(hello.surfaceVersion);
    },
  });
  return {
    client: mountStreamRetry(scopePadiSurface(dial.client)),
    dispose: dial.dispose,
  };
}
