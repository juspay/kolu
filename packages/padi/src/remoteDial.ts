/**
 * `@kolu/padi/remote-dial` — the REMOTE half of padi's dial: reaching a padi on
 * ANOTHER host over ssh, by provisioning the exact closure this build was baked
 * with.
 *
 * It lives with the DAEMON package, not with `@kolu/padi-client`, because that is
 * where the thing it ships lives: `PADI_REMOTE_DIAL` names a nix package and a
 * binary, `dialAgentOnce` copies that closure to the host and execs it. A client
 * that only speaks to an already-running padi over a unix socket wants none of
 * it — and, since hydration is per-package, must not be made to install
 * `@kolu/surface-remote` and `kolu-pty` to get a socket dial
 * (juspay/kolu#2216). The LOCAL dial, the faces, and the compatibility gate are
 * `@kolu/padi-client/dial`; this module composes them.
 */

import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { Surface } from "@kolu/surface/define";
import { type AgentDial, dialAgentOnce } from "@kolu/surface-remote";
import {
  assertPadiSurfaceCompatible,
  type PadiSurfaceClient,
} from "@kolu/padi-client/dial";
import {
  padiDaemonGroup,
  type padiSurface,
  padiSurfaceSibling,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";
import { composeSpawnEnv } from "kolu-pty";

/**
 * Provision and dial a padi on `host` using the exact source flake baked into
 * the caller's Nix wrapper. This is padi's client-side remote transport policy:
 * both padi-tui and kolu-cli share the same binary, fatal-prefix, clean local
 * environment, and frozen-control-core compatibility gate.
 *
 * Lifecycle supervision remains outside this dial kit. The returned connection
 * is one-shot and reading `hello` never drains or replaces the remote daemon.
 */
/** How a remote kolu-managed padi is reached — the CLOSURE provisioned onto the
 *  host (the daemon PLUS the client CLIs a terminal there must be able to run)
 *  and the BINARY exec'd inside it. One value, so no dial path can name half of
 *  it: `padi-agent` here and a bare `padi` over there is how one host ended up
 *  receiving two different closures, with `padi-tui --host` / `kolu mcp --host`
 *  terminals missing the toolchain the browser path's terminals had.
 *
 *  Both dial paths import THIS — `dialPadiViaHost` below, and kolu-server's
 *  long-lived binder (`server/src/padi/remotePadiBinding.ts`). */
export const PADI_REMOTE_DIAL = {
  package: "padi-agent",
  binary: "padi",
} as const;

/** The `Surface` an ssh dial is opened with: padi's SIBLING spec (so the face it
 *  builds is `client.surface.<member>.<verb>` at `surface/padi/*` — what every
 *  consumer of a remote padi actually holds) carried over the FULL daemon group
 *  (so the link can reach the control sibling's tags too).
 *
 *  Two halves, deliberately: `sshConnector` reads `.group` to open the link and
 *  walks `.spec`/`.tagPrefix` to build the face. Splitting them is the only way
 *  to dial a two-sibling daemon through a one-surface connector, and it is
 *  honest — the group IS what the daemon serves, the spec IS what the face
 *  addresses. */
const padiRemoteDialSurface: Surface<typeof padiSurface.spec> = {
  ...padiSurfaceSibling,
  group: padiDaemonGroup,
};

export function dialPadiViaHost(host: string): Promise<AgentDial> {
  return dialAgentOnce({
    surface: padiRemoteDialSurface,
    host,
    localEnv: composeSpawnEnv(process.env),
    ...PADI_REMOTE_DIAL,
    fatalPrefix: "padi --stdio:",
    probe: (client) => {
      // The compatibility gate, over the padi face this dial hands back.
      //
      // The LOCAL dial gates on the frozen control-core `hello`; this one gates
      // on padi's own `identity` cell, and they are the SAME FACT: padi seeds
      // `identity` at boot from the same source constants `hello` reads, never
      // re-derived (see `PadiIdentitySchema`), precisely so a per-host consumer
      // can read the RUNNING padi's identity directly (P3).
      //
      // Sound here because this is a REFUSE-ONLY gate — a one-shot dial never
      // drains or converges a running padi (#1313), so its only two outcomes are
      // "proceed" and "fail loud", and an unreadable `identity` produces exactly
      // the refusal a version mismatch does. WITHIN a protocol epoch the two
      // reads are interchangeable; ACROSS one neither is reachable (the framing
      // itself differs — D6's `unspeakable-protocol`, the supervisor's domain).
      //
      // The reason it is not simply the control core: `sshConnector` builds ONE
      // face from ONE surface and never hands the link's `dispatch` back, so a
      // consumer of `dialAgentOnce` cannot build a second sibling's face. If
      // `AgentDial` ever carries the dispatch, swap this for
      // `padiClientOver(dial.dispatch).control.surface.core.hello()` and delete
      // this note.
      const face = client as unknown as PadiSurfaceClient;
      return Effect.map(
        firstFrameOrThrow(
          face.surface.identity.get(undefined),
          "padi handshake failed — the identity cell yielded no frame",
        ),
        (identity) => {
          assertPadiSurfaceCompatible(identity.surfaceVersion);
        },
      );
    },
  });
}

