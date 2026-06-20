/**
 * `kaval-tui --host <ssh>` — reach a kaval on a remote machine over ssh,
 * provisioning it with Nix, and hand back a `Connection` of the SAME shape the
 * local unix-socket path returns. Every `cmd*()` (list/create/snapshot/attach)
 * is written against `Connection`, so the transport is the only thing that
 * changes — the commands are byte-for-byte unchanged over ssh.
 *
 * The reach + provision + supervise + one-shot-dial composition is
 * `@kolu/surface-nix-host`'s `dialAgentOnce`: it resolves the daemon's `.drv`
 * for the host's arch, ships it (`nix copy --derivation` → realise), runs
 * `ssh <host> kaval --stdio`, speaks `ptyHostSurface` over that child's stdio,
 * and proves the link with the caller's `probe` before flipping the connect
 * watchdog off. kaval's `--stdio` mode fronts the *durable* daemon (see
 * `kaval/src/stdioBridge.ts`), so a PTY a `create` spawns survives the ssh link
 * and a later `attach` finds it.
 *
 * kaval's only volatile differences from the other one-shot CLIs (arivu-tui):
 * the binary name, the per-system drv-map env var, and the connectivity probe
 * (`system.heartbeat` — kaval's atomic liveness verb).
 *
 * This is the ONLY place kaval-tui imports `@kolu/surface-nix-host` — it must
 * never leak into the kaval daemon closure (the staleKey allow-list).
 */
import { dialAgentOnce } from "@kolu/surface-nix-host";
import type { ptyHostSurface } from "kaval";
import type { Connection } from "./connect.ts";

type PtyHostContract = typeof ptyHostSurface.contract;

/** The per-system `{ system → kaval .drv }` map env var, baked by the
 *  `kaval-tui` Nix wrapper (`mkAgentTuiWrapper` in default.nix). Named ONCE as a
 *  constant so the literal passed to `dialAgentOnce` (for its errors) and the
 *  `process.env[…]` read can't drift apart — TS has no way to tie a bare string
 *  literal to the matching `process.env.FOO` property otherwise. */
const KAVAL_AGENT_DRVS_ENV = "KAVAL_AGENT_DRVS_JSON";

/** Dial a kaval on `host` over ssh. Provisions the daemon's closure, runs
 *  `kaval --stdio`, and returns the contract-typed `Connection`. */
export function connectPtyHostViaHost(host: string): Promise<Connection> {
  return dialAgentOnce<PtyHostContract>({
    host,
    // `${agentPath}/bin/kaval`, run as `kaval --stdio`.
    binary: "kaval",
    envVar: KAVAL_AGENT_DRVS_ENV,
    agentDrvsJson: process.env[KAVAL_AGENT_DRVS_ENV],
    drvNoun: "kaval",
    // One cheap RPC that roundtrips kaval's atomic liveness verb.
    probe: (client) => client.surface.system.heartbeat({}),
  });
}
