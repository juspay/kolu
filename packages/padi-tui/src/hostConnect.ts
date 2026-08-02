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
 * Unlike kaval-tui, padi-tui nominates its OWN `probe` — nominated inside the
 * shared dial kit, not here. The dial's default liveness round-trip
 * (`system.live`) proves the LINK, but padi additionally gates the padiSurface
 * CONTRACT version — the same skew judgement `connectPadi` applies to the local
 * socket. The remote probe reads padi's own `identity` cell (the local one reads
 * the frozen control core's `hello`; they are the same fact, seeded at boot from
 * the same constants) and runs the shared `assertPadiSurfaceCompatible`, so a
 * remote padi too new for this build — or a padi-tui too old — fails LOUD with the
 * SAME "upgrade" line the local path gives: a protocol assertion beyond liveness.
 *
 * A tui is a DIAL, never a supervisor (#1313): this reads the remote `hello` only
 * to GATE, and never drains / converges / recycles the remote padi — that is the
 * kolu-server binder's job (`server/src/padi/remotePadiBinding.ts`), never a CLI's.
 *
 * padi-tui depends only on padi's client kit here; the transport volatility
 * remains implemented by `@kolu/surface-remote`.
 */
import { dialPadiViaHost } from "@kolu/padi/dial";
import type { Connection, PadiTuiClient } from "./connect.ts";

/** Dial a padi on `host` over ssh, one-shot. Provisions the daemon's closure, runs
 *  `padi --stdio`, gates the padiSurface contract version, and returns the
 *  padi-sibling-scoped `Connection` the verbs speak. */
export async function connectPadiTuiViaHost(host: string): Promise<Connection> {
  const dial = await dialPadiViaHost(host);
  // There is nothing left to SCOPE here. `dialPadiViaHost` opens the ssh link with
  // padi's SIBLING surface (`padiRemoteDialSurface` in the dial kit), so the face
  // it hands back already addresses `surface/padi/<member>` — the flat-tag
  // successor of the old combined client whose `.surface.padi` namespace this used
  // to narrow. Naming that face is a CAST because `AgentDial.client` is the
  // framework's deliberately STRUCTURAL `SurfaceFace`: per-member precision is
  // spec-derived one layer up (D2/#16 — a second precise mapped type over the same
  // spec is the union-budget blowup the erased seam exists to avoid), so the ssh
  // connector cannot hand back a padi-typed value however the dial is spelled.
  // It is the SAME claim `padiClientOver` makes on the local leg, and it is checked
  // where it can be: the dial's own `probe` reads `identity` through this face and
  // refuses a skewed padi before this line is reached.
  //
  // `localCwd: undefined`: a remote padi runs elsewhere, so our local cwd need not
  // exist there — `create` omits cwd and lets padi default to the host's home.
  return {
    client: dial.client as unknown as PadiTuiClient,
    dispose: dial.dispose,
    localCwd: undefined,
  };
}
