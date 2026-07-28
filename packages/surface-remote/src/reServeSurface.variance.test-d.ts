/**
 * Type-level regression: a SPECIFIC-contract session must remain assignable to the
 * loose `Session` receptacle `pumpRemoteSurface` / `reServeSurface` consume.
 *
 * `makeSession(sshConnector<C>(...))` yields `Session<AgentClient<C>>` — a session
 * whose reserved `system.live` proc takes `Record<string, never>`. The pump takes
 * the LOOSE `Session` (its `Client` param defaults to `SurfaceClientLike`). `Session`
 * uses `Client` only in RETURN positions (`pin` / `currentClient`), so it is
 * COVARIANT in `Client`, and `AgentClient<C>` structurally satisfies
 * `SurfaceClientLike` (`{ surface: Record<string, unknown> }`) — so a
 * specific-contract session assigns to the general receptacle.
 *
 * Narrowing the pump's `session` param back to a specific per-contract client would
 * reintroduce input contravariance (`unknown` not assignable to
 * `Record<string, never>`) and break drishti's un-annotated `pumpRemoteSurface(...)`
 * call — the exact regression kolu gauntlet `5725e8d01` hit under the old
 * `RemoteMirrorSession`. Dropping the dead contract `<C>` at the role boundary (S3)
 * and keeping the receptacle at `SurfaceClientLike` is what keeps it covariant. No
 * runtime; `tsc --noEmit` (part of `just check`) is the check.
 */

import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";
import { pumpRemoteSurface } from "./hostFanout";
import { directAgentDerivation } from "./agentDerivation";
import type { SurfaceClientLike } from "@kolu/surface/project";
import { makeSession, type Session } from "./session";
import { type AgentClient, sshConnector } from "./sshConnector";
import { TEST_BINARY_CACHE } from "./agentDerivation.testutil";

// A concrete, app-shaped surface: one cell, whose contract also carries the
// framework-reserved `system.live` proc (input `Record<string, never>`) — the exact
// member the old failure pointed at.
const specificSurface = defineSurface({
  cells: { status: { schema: z.string(), default: "" } },
});
type SpecificContract = typeof specificSurface.contract;

// A specific-client session, the shape `makeSession(sshConnector<Specific>(...))`
// produces.
declare const specificSession: Session<AgentClient<SpecificContract>>;

// (1) The specific-contract session assigns to the general receptacle role.
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

// (3) The concrete builder really does yield a specific-client session — the typed
//     `AgentClient<C>` survives for a direct consumer (odu reads `session.pin()`'s
//     typed client), while the CLIENT loosening is confined to the receptacle's VIEW.
//     An ssh builder's session carries `Prov = SshProv` (it provisions); the pump's
//     loose receptacle is `Session<SurfaceClientLike, string>` (phase-vocabulary TOP),
//     so it accepts that provisioning `Prov` AND widens the CLIENT (`AgentClient<C>` →
//     `SurfaceClientLike`) — the covariance this file pins.
const built = makeSession({
  initialConnection: "probing",
  connectOnce: sshConnector<SpecificContract>({
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
const typedClient: Promise<AgentClient<SpecificContract>> = built.pin();
void typedClient;
