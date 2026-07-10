/**
 * `padi-tui --host <ssh>` — reach a padi on a remote machine over ssh,
 * provisioning it with Nix, and hand back a `Connection` of the SAME shape the
 * local socket path returns. Every `cmd*()` (status/watch/wait/create) is written
 * against that `Connection`, so the transport is the only thing that changes — the
 * verbs run byte-for-byte unchanged over ssh.
 *
 * The reach + provision + one-shot-dial composition is `@kolu/surface-remote`'s
 * `dialAgentOnce`: it resolves padi's `.drv` for the host's arch, ships it
 * (`nix copy --derivation` → realise), runs `ssh <host> padi --stdio`, and speaks
 * the COMBINED `padiDaemonContract` (padiSurface + the frozen control core) over
 * that child's stdio. padi's `--stdio` mode fronts the *durable* daemon (see
 * `padi/src/stdioBridge.ts`), so a terminal a remote `create` spawns — and its
 * kaval and PTYs — outlives the ssh link, exactly as `kaval-tui --host` does for a
 * bare PTY. This is the twin of `kaval-tui/src/hostConnect.ts`.
 *
 * Unlike kaval-tui, padi-tui nominates its OWN `probe`. The dial's default
 * liveness round-trip (`system.live`) proves the LINK, but padi additionally gates
 * the padiSurface CONTRACT version — the same skew judgement `connectPadi` applies
 * to the local socket. Reading the frozen control core's `hello` (always reachable
 * even at a padiSurface skew) and running the shared `assertPadiSurfaceCompatible`
 * makes a remote padi too new for this build (or a padi-tui too old) fail LOUD with
 * the SAME "upgrade" line the local path gives — a protocol assertion beyond
 * liveness, which is pulam-tui's precedent for overriding `probe`.
 *
 * A tui is a DIAL, never a supervisor (#1313): this reads the remote `hello` only
 * to GATE, and never drains / converges / recycles the remote padi — that is the
 * kolu-server binder's job (`server/src/padi/remotePadiBinding.ts`), never a CLI's.
 *
 * This is the ONLY place padi-tui imports `@kolu/surface-remote` — it must never
 * leak into padi's own daemon closure.
 */
import { assertPadiSurfaceCompatible, scopePadiSurface } from "@kolu/padi/dial";
import type { PadiDaemonContract } from "@kolu/padi/surface";
import { dialAgentOnce } from "@kolu/surface-remote";
import type { Connection } from "./connect.ts";

/** The per-system `{ system → padi .drv }` map env var, baked onto the padi-tui
 *  Nix wrapper (`mkAgentTuiWrapper` in default.nix) — the SAME map koluBin bakes
 *  for the server's remote binding. Named ONCE as a constant so the literal passed
 *  to `dialAgentOnce` (for its errors) and the `process.env[…]` read can't drift
 *  apart — TS has no way to tie a bare string literal to the matching
 *  `process.env.FOO` property otherwise. */
const PADI_AGENT_DRVS_ENV = "PADI_AGENT_DRVS_JSON";

/** Dial a padi on `host` over ssh, one-shot. Provisions the daemon's closure, runs
 *  `padi --stdio`, gates the padiSurface contract version, and returns the
 *  padi-sibling-scoped `Connection` the verbs speak. */
export async function connectPadiTuiViaHost(host: string): Promise<Connection> {
  const dial = await dialAgentOnce<PadiDaemonContract>({
    host,
    // `${agentPath}/bin/padi`, run as `padi --stdio`. The connector appends
    // `--stdio` itself, so it is NEVER added here (F2 in remotePadiBinding).
    binary: "padi",
    envVar: PADI_AGENT_DRVS_ENV,
    agentDrvsJson: process.env[PADI_AGENT_DRVS_ENV],
    drvNoun: "padi",
    // The remote runs `padi --stdio`, whose fatal prefix is `padi --stdio:` (NOT
    // `padi:` — see padi/src/stdioBridge.ts + bin.ts), so the dial surfaces the
    // remote's own reason instead of the transport's opaque "stream closed".
    fatalPrefix: "padi --stdio:",
    // A protocol assertion BEYOND liveness (pulam-tui's precedent for overriding
    // `probe`): read the frozen control core's `hello` and gate the padiSurface
    // contract version — the SAME judgement `connectPadi` runs against the local
    // socket — so a skew fails loud here rather than deep inside oRPC. GATE only; a
    // tui never drains or converges the remote padi (#1313).
    probe: async (client) => {
      const hello = await client.surface.control.core.hello();
      assertPadiSurfaceCompatible(hello.surfaceVersion);
    },
  });
  // Scope the COMBINED dialed client down to the padi sibling so `.surface.<member>`
  // resolves at /surface/padi/<member> — the same scope the local dial and the
  // re-serve use, so every verb is transport-blind over it.
  return { client: scopePadiSurface(dial.client), dispose: dial.dispose };
}
