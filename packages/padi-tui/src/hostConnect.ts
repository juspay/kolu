/**
 * `padi-tui --host <ssh>` — reach a padi on a remote machine over ssh,
 * provisioning it with Nix, and hand back a `Connection` of the SAME shape the
 * local socket path returns. Every `cmd*()` (status/watch/wait/create) is written
 * against that `Connection`, so the transport is the only thing that changes — the
 * verbs run byte-for-byte unchanged over ssh.
 *
 * The reach + provision + one-shot-dial composition is padi's shared client
 * dial kit: it selects padi from the exact baked source for the host's
 * architecture, provisions and roots it through the target Nix store, runs
 * `ssh <host> padi --stdio`, and speaks
 * the COMBINED `padiDaemonContract` (padiSurface + the frozen control core) over
 * that child's stdio. padi's `--stdio` mode fronts the *durable* daemon (see
 * `padi/src/stdioBridge.ts`), so a terminal a remote `create` spawns — and its
 * kaval and PTYs — outlives the ssh link, exactly as `kaval-tui --host` does for a
 * bare PTY.
 *
 * Unlike kaval-tui, padi-tui nominates its OWN `probe`. The dial's default
 * liveness round-trip (`system.live`) proves the LINK, but padi additionally gates
 * the padiSurface CONTRACT version — the same skew judgement `connectPadi` applies
 * to the local socket. Reading the frozen control core's `hello` (always reachable
 * even at a padiSurface skew) and running the shared `assertPadiSurfaceCompatible`
 * makes a remote padi too new for this build (or a padi-tui too old) fail LOUD with
 * the SAME "upgrade" line the local path gives — a protocol assertion beyond
 * liveness, following the retired pulam-tui's precedent for overriding `probe`.
 *
 * A tui is a DIAL, never a supervisor (#1313): this reads the remote `hello` only
 * to GATE, and never drains / converges / recycles the remote padi — that is the
 * kolu-server binder's job (`server/src/padi/remotePadiBinding.ts`), never a CLI's.
 *
 * padi-tui depends only on padi's client kit here; the transport volatility
 * remains implemented by `@kolu/surface-remote`.
 */
import { dialPadiViaHost, scopePadiSurface } from "@kolu/padi/dial";
import type { Connection } from "./connect.ts";

/** Dial a padi on `host` over ssh, one-shot. Provisions the daemon's closure, runs
 *  `padi --stdio`, gates the padiSurface contract version, and returns the
 *  padi-sibling-scoped `Connection` the verbs speak. */
export async function connectPadiTuiViaHost(host: string): Promise<Connection> {
  const dial = await dialPadiViaHost(host);
  // Scope the COMBINED dialed client down to the padi sibling so `.surface.<member>`
  // resolves at /surface/padi/<member> — the same scope the local dial and the
  // re-serve use, so every verb is transport-blind over it. `localCwd: undefined`:
  // a remote padi runs elsewhere, so our local cwd need not exist there — `create`
  // omits cwd and lets padi default to the host's home.
  return {
    client: scopePadiSurface(dial.client),
    dispose: dial.dispose,
    localCwd: undefined,
  };
}
