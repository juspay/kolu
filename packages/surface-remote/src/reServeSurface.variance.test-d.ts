/**
 * Type-level regression: a SPECIFIC-surface session must remain assignable to the
 * loose `Session` receptacle `pumpRemoteSurface` / `reServeSurface` consume.
 *
 * `makeSession(sshConnector({ surface, … }))` yields `Session<AgentClient>` — a
 * session whose client is the surface FACE. The pump takes the LOOSE `Session` (its
 * `Client` param defaults to `SurfaceClientLike`). `Session` uses `Client` only in
 * RETURN positions (`pin` / `currentClient`), so it is COVARIANT in `Client`, and
 * `AgentClient` structurally satisfies `SurfaceClientLike`
 * (`{ surface: Record<string, unknown> }`) — so a specific session assigns to the
 * general receptacle.
 *
 * Narrowing the pump's `session` param back to a per-surface client type would
 * reintroduce input contravariance and break drishti's un-annotated
 * `pumpRemoteSurface(...)` call — the exact regression kolu gauntlet `5725e8d01` hit
 * under the old `RemoteMirrorSession`. Keeping the receptacle at `SurfaceClientLike`
 * is what keeps it covariant. No runtime; `tsc --noEmit` (part of `just check`) is
 * the check.
 *
 * The dead contract type parameter is GONE from both ends now (`AgentClient` is the
 * structural `SurfaceFace`, and `sshConnector` takes the surface as a VALUE), so the
 * variance this file pins is the only client-typing question left at the seam.
 */

import { defineSurface } from "@kolu/surface/define";
import type { SurfaceClientLike } from "@kolu/surface/project";
import { Schema } from "effect";
import { directAgentDerivation } from "./agentDerivation";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";
import { pumpRemoteSurface } from "./hostFanout";
import { makeSession, type Session } from "./session";
import { type AgentClient, sshConnector } from "./sshConnector";

// A concrete, app-shaped surface: one cell, whose group also carries the
// framework-reserved `system/live` member — the exact member the old failure
// pointed at.
const specificSurface = defineSurface({
  cells: { status: { schema: Schema.String, default: "" } },
});

// A specific-client session, the shape `makeSession(sshConnector({ surface }))`
// produces.
declare const specificSession: Session<AgentClient>;

// (1) The specific session assigns to the general receptacle role.
const loose: Session = specificSession;
void loose;

// (2) drishti's ACTUAL call shape, verbatim: `pumpRemoteSurface` with an
//     un-annotated options object, `source` a specific surface and `session` its
//     specific-client session. `makeSink` is trivial (every `SurfaceSink` member is
//     optional). This is the end-to-end mirror of the consumer that regressed.
void pumpRemoteSurface({
  source: specificSurface,
  session: specificSession,
  makeSink: () => ({}),
});

// (3) The concrete builder really does yield a session whose client is the face —
//     the CLIENT loosening is confined to the receptacle's VIEW. An ssh builder's
//     session carries `Prov = SshProv` (it provisions); the pump's loose receptacle
//     is `Session<SurfaceClientLike, string>` (phase-vocabulary TOP), so it accepts
//     that provisioning `Prov` AND widens the CLIENT (`AgentClient` →
//     `SurfaceClientLike`) — the covariance this file pins.
const built = makeSession({
  initialConnection: "probing",
  connectOnce: sshConnector({
    surface: specificSurface,
    host: "h",
    binary: "b",
    localEnv: {},
    resolveDrvPath: () =>
      Promise.resolve(
        directAgentDerivation("/nix/store/x-agent.drv", TEST_BINARY_CACHE),
      ),
  }),
});
const looseBuilt: Session<SurfaceClientLike, string> = built;
void looseBuilt;
const typedClient: Promise<AgentClient> = built.pin();
void typedClient;
