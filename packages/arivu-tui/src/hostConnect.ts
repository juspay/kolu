/**
 * `arivu-tui --host <ssh>` — reach an `arivu` daemon on a remote machine over
 * ssh, provisioning it with Nix, and hand back a `Connection` of the SAME shape
 * the local unix-socket path returns. Every `cmd*()` (list/watch) is written
 * against `Connection`, so the transport is the only thing that changes — the
 * commands are byte-for-byte unchanged over ssh.
 *
 * The reach + provision + supervise + one-shot-dial composition is
 * `@kolu/surface-nix-host`'s `dialAgentOnce`: it resolves the daemon's `.drv`
 * for the host's arch, ships it (`nix copy --derivation` → realise), runs
 * `ssh <host> arivu --stdio`, speaks `arivuSurface` over that child's stdio, and
 * proves the link with the caller's `probe` before flipping the connect watchdog
 * off. arivu's `--stdio` mode (built in P1c) is the serve seam the ssh dial
 * speaks to — the remote arivu dials the remote kaval locally and recomputes
 * awareness from now. Unlike kaval, arivu is ephemeral, so a re-provision just
 * re-derives; nothing survives the link.
 *
 * arivu's only volatile differences from the other one-shot CLIs (kaval-tui):
 * the binary name, the per-system drv-map env var, and the connectivity probe.
 * arivu has no `system.heartbeat` (its surface is the `awareness` collection + a
 * `version` cell), so the probe reads the first frame of the `version` cell —
 * which doubles as exercising the seam the kolu fold's version-skew gate later
 * consumes.
 *
 * This is the ONLY place arivu-tui imports `@kolu/surface-nix-host` — it must
 * never leak into the arivu daemon closure (the staleKey allow-list). The dep is
 * consumed read-only and unchanged, so it needs no drishti mirror PR.
 */
import type { arivuSurface } from "@kolu/arivu-contract";
import { dialAgentOnce } from "@kolu/surface-nix-host";
import type { Connection } from "./connect.ts";

type ArivuContract = typeof arivuSurface.contract;

/** Dial an arivu on `host` over ssh. Provisions the daemon's closure, runs
 *  `arivu --stdio`, and returns the contract-typed `Connection`. */
export function connectArivuViaHost(host: string): Promise<Connection> {
  return dialAgentOnce<ArivuContract>({
    host,
    // `${agentPath}/bin/arivu`, run as `arivu --stdio`. The drv map is keyed to
    // the arivu DAEMON drv (sensors + git/gh), not the arivu-tui viewer.
    binary: "arivu",
    envVar: "ARIVU_AGENT_DRVS_JSON",
    agentDrvsJson: process.env.ARIVU_AGENT_DRVS_JSON,
    drvNoun: "arivu",
    // arivu has no `system.heartbeat`, so read the first frame of the `version`
    // cell as the connectivity probe.
    probe: (client) => firstFrame(client.surface.version.get({})),
  });
}

/** Read the first value an async stream yields (then close it), or `undefined`
 *  if it ends empty — used to turn arivu's snapshot-then-delta `version` cell
 *  into the one-shot dial's connectivity probe. */
async function firstFrame(
  streamPromise: Promise<AsyncIterable<unknown>>,
): Promise<unknown> {
  for await (const v of await streamPromise) return v;
  return undefined;
}
