/**
 * `@kolu/padi/dial` — the CLIENT-SIDE DIAL KIT for a padi daemon.
 *
 * One place spells how a client reaches padi: resolve a state-root to its
 * digest-keyed socket (re-exported from {@link ./stateRoot.ts}), dial it, and
 * handshake the FROZEN control core — hello · version compare · typed skew
 * refusal — returning the live, version-checked connection whose `.client` is the
 * COMBINED-contract client (it reaches `.surface.control.core.*` AND scopes to
 * `.surface.padi`). This is the kaval precedent: a daemon's package owns the dial
 * kit its clients share, so BOTH consumers import it —
 *   - kolu-server's binder (`server/src/padi/padiBinding.ts`), which layers
 *     SUPERVISION (drivers · adopt/spawn/refuse · the newer-binder drain
 *     convergence · the reconnect-mirror session · the re-serve) on top; and
 *   - `padi-tui`, which dials, runs one verb, and disposes.
 *
 * Supervision is NOT here, on purpose. The version ORDERING that decides
 * drain-vs-refuse (padi's `ConvergencePolicy`, enacted by the shared convergence
 * kit's `converge()` over a version-agnostic identity probe), the drivers, and the
 * reconnect-mirror session all stay binder-only: a running padi is never killed or
 * drained by a mere dial — only by the supervisor that owns it (#1313). The dial kit does
 * exactly one version judgement — the COMPATIBILITY gate (`connectPadi` refuses a
 * padi it cannot speak to, loudly) — and nothing that mutates padi's lifecycle.
 */

import {
  isContractVersionCompatible,
  scopeSibling,
} from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
} from "@kolu/surface-daemon-supervisor";
import { type AgentDial, dialAgentOnce } from "@kolu/surface-remote";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { composeSpawnEnv } from "kolu-pty";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
  type PadiHello,
  type padiSurface,
} from "./surface.ts";

// The client-side rendezvous resolve is part of the dial kit — `state-root →
// digest → socket`, plus the read-only multi-daemon discovery a flag-less client
// labels what it finds with. Re-exported through this entry so a consumer reaches
// the whole dial kit from ONE import, without pulling in the node-only
// terminal-domain `@kolu/padi/assembly` barrel (the daemon runtime) just to
// compute a socket path.
export {
  discoverPadiDaemons,
  type PadiDaemon,
  type PadiSocketResolution,
  padiSocketPath,
  residentPadiSocket,
  resolvePadiStateRoot,
  resolveRunningPadiSocket,
} from "./stateRoot.ts";

// The client-side terminal WATCH kit — `watchTerminals` + `awaitAgentState` +
// `awaitOutputSettled` and the bucket vocabulary they predicate on — rides the
// dial entry too: the same "a daemon's package owns the client kit its
// consumers share" rule, and both consumers (padi-tui's `wait`/`watch`, the
// kolu MCP face's `wait_agentState`/`wait_outputSettled`) already import this
// entry to dial.
export {
  activeAgent,
  agentMatchesUntil,
  type AgentStateOutcome,
  awaitAgentState,
  awaitOutputSettled,
  type OutputSettledOutcome,
  WAIT_STATES,
  type WaitState,
  type WatchHandlers,
  watchTerminals,
} from "./watch.ts";

// ── Types ────────────────────────────────────────────────────────────────────

/** The client a dial produces — typed to the COMBINED contract, so the handshake
 *  reaches `.surface.control.core.hello()` AND a consumer can scope
 *  `.surface.padi` (via `scopeSibling`). Structurally identical to
 *  surface-remote's `AgentClient<PadiDaemonContract>` (both are
 *  `ContractRouterClient<C, ClientRetryPluginContext>` — the shape `stdioLink`
 *  returns), spelled from padi's OWN oRPC deps so the type needs no AgentClient
 *  import. The one-shot remote dial deliberately depends on
 *  `@kolu/surface-remote`; only this client entry loads that edge, never padi's
 *  daemon entrypoints. */
export type PadiDaemonClient = ContractRouterClient<
  PadiDaemonContract,
  ClientRetryPluginContext
>;

/** The padi-SIBLING-scoped client — `.surface.padi.<member>` — a consumer derives
 *  from a {@link PadiConnection}'s combined `.client` via `scopeSibling(client,
 *  "padi")`. The binder's re-serve mirrors it; padi-tui's verbs call it. */
export type PadiSurfaceClient = ContractRouterClient<
  typeof padiSurface.contract,
  ClientRetryPluginContext
>;

/** Narrow a dialed COMBINED client down to its `.surface.padi` sibling — the LAST
 *  mile of "reaching padi's surface", owned by the kit that owns
 *  {@link PadiSurfaceClient}. The `"padi"` sibling key and the (framework-forced)
 *  cast live HERE, once, so a plain-dial consumer asks for a padi client instead of
 *  re-narrowing the combined one itself. The binder keeps the combined `.client`
 *  for supervision (`control.core.drain`) and calls this only for its relay's
 *  scoped client; padi-tui's dial calls it for the verbs. */
export function scopePadiSurface(client: PadiDaemonClient): PadiSurfaceClient {
  return scopeSibling(client, "padi") as unknown as PadiSurfaceClient;
}

/** padi's wire identity, from its control-core `hello`. `commit` is the RUNNING
 *  padi's navigable git build (the Padi dialog's "build commit"); optional — a
 *  survivor padi predating the hello field omits it (honest "—"). No bare
 *  `undefined` variant: a `DaemonConnection`/`EndpointStatus` only ever carries
 *  an `I` when `state === "connected"` (the surrounding union's OTHER arms omit
 *  `identity` entirely via `identity?: never`), and {@link connectPadi} always
 *  builds a full object — so a connected padi's identity is never absent, and
 *  the absent case already has its own representation one level up. */
export type PadiHelloIdentity = {
  stateRoot: string;
  surfaceVersion: string;
  commit?: string;
};
export type PadiConnectionMetadata = {
  surfaceVersion: string;
  controlCoreVersion: string;
};
export type PadiConnection = DaemonConnection<
  PadiDaemonClient,
  PadiHelloIdentity,
  PadiConnectionMetadata
>;

/** The dialed-but-unjudged result of reaching padi's frozen control core: the
 *  live client, its socket, and the `hello` it answered. The version judgement is
 *  the CALLER's — this only opens the link and reads identity. Shared by
 *  {@link connectPadi} (which applies the `isContractVersionCompatible` gate, then
 *  holds or refuses) and the binder's convergence probe
 *  (`probeDaemonIdentity`, which reads identity for padi's `ConvergencePolicy`
 *  to drain or leave be). */
export type PadiDial = {
  socket: Awaited<ReturnType<typeof dialSocket>>;
  client: PadiDaemonClient;
  hello: PadiHello;
};

// ── The compatibility gate ────────────────────────────────────────────────────

/**
 * Gate a padi's RUNNING `padiSurface` version against THIS build's
 * {@link PADI_SURFACE_VERSION}, throwing {@link DaemonContractSkewError} on an
 * incompatible skew (different major, or an older minor than this client needs).
 *
 * The dial kit's ONE compatibility judgement, shared across BOTH transports so
 * they can never drift apart: {@link connectPadi} runs it after the local-socket
 * control-core handshake, and `padi-tui --host`'s ssh probe runs it after the
 * remote control-core `hello`. Either way a padi too new for this build — or a
 * client too old — fails LOUD with the SAME honest "upgrade" line, rather than a
 * parallel hand-rolled check that reads the same fields but risks diverging.
 * GATE only: reading `hello` to judge compatibility never touches the daemon's
 * lifecycle — a running padi is drained/converged only by the supervisor that
 * owns it (#1313), never by a dial.
 */
export function assertPadiSurfaceCompatible(
  runningSurfaceVersion: string,
): void {
  if (
    !isContractVersionCompatible(runningSurfaceVersion, PADI_SURFACE_VERSION)
  ) {
    throw new DaemonContractSkewError({
      subject: "padiSurface",
      daemonVersion: runningSurfaceVersion,
      requiredVersion: PADI_SURFACE_VERSION,
    });
  }
}

/**
 * Provision and dial a padi on `host` using the exact source flake baked into
 * the caller's Nix wrapper. This is padi's client-side remote transport policy:
 * both padi-tui and kolu-cli share the same binary, fatal-prefix, clean local
 * environment, and frozen-control-core compatibility gate.
 *
 * Lifecycle supervision remains outside this dial kit. The returned connection
 * is one-shot and reading `hello` never drains or replaces the remote daemon.
 */
export function dialPadiViaHost(
  host: string,
): Promise<AgentDial<PadiDaemonContract>> {
  return dialAgentOnce<PadiDaemonContract>({
    host,
    localEnv: composeSpawnEnv(process.env),
    binary: "padi",
    fatalPrefix: "padi --stdio:",
    probe: async (client) => {
      const hello = await client.surface.control.core.hello();
      assertPadiSurfaceCompatible(hello.surfaceVersion);
    },
  });
}

// ── The dial + control-core handshake ─────────────────────────────────────────

/** Dial padi at `socketPath` and read the FROZEN control core's `hello` — the
 *  version-agnostic handshake, always reachable even at a `padiSurface` skew (the
 *  control-core schemas never move). Mirrors `connectKaval` on link choice:
 *  `dialSocket` + `stdioLink` (NOT `unixSocketLink`, which hides the socket's
 *  `close` event the endpoint's `onClose` needs). Rejects with a plain Error if
 *  the socket is unreachable or `hello` is unreadable — a non-skew failure. */
export async function dialPadiHello(socketPath: string): Promise<PadiDial> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<PadiDaemonContract>({
    read: socket,
    write: socket,
  }) as PadiDaemonClient;
  try {
    const hello = await client.surface.control.core.hello();
    return { socket, client, hello };
  } catch (err) {
    socket.destroy();
    throw new Error(
      `padi handshake failed — could not read control.core.hello (${(err as Error).message})`,
    );
  }
}

/**
 * Dial padi, handshake the FROZEN control core, and return the live connection.
 * Typed to `PadiDaemonContract` so the handshake reaches
 * `client.surface.control.core.hello()`.
 *
 * The handshake gates on the SURFACE version (`hello.surfaceVersion` vs
 * `PADI_SURFACE_VERSION`), NOT the frozen control-core version (which never
 * moves). Three failure classes, same as connectKaval:
 *   - raw socket error → plain reject (transient);
 *   - unreadable hello → plain Error (non-skew);
 *   - genuine surface skew → `DaemonContractSkewError`. For the binder this is the
 *     endpoint's generic signal to REFUSE (padi left standing + degraded, never
 *     recycled — a binder never kill-9's a running padi, #1313); for `padi-tui`
 *     it is the loud "your kolu/padi are out of step, upgrade" the CLI surfaces
 *     instead of speaking a contract it doesn't share. (The binder's NEWER-binder
 *     DRAIN arm runs BEFORE this, in its own pre-flight, so by the time the
 *     endpoint calls `connectPadi` a newer binder's skewed survivor is already
 *     drained + gone and this connect is against the fresh newer closure.)
 */
export async function connectPadi(socketPath: string): Promise<PadiConnection> {
  const { socket, client, hello } = await dialPadiHello(socketPath);

  try {
    // The dial kit's one compatibility judgement (shared with `padi-tui --host`'s
    // ssh probe). This connect OWNS the socket, so tear it down before surfacing a
    // skew — the remote probe's teardown is `dialAgentOnce`'s, so it just rethrows.
    assertPadiSurfaceCompatible(hello.surfaceVersion);
  } catch (err) {
    socket.destroy();
    throw err;
  }

  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client,
    identity: {
      stateRoot: hello.stateRoot,
      surfaceVersion: hello.surfaceVersion,
      // The RUNNING padi's navigable git commit off the hello (optional — a survivor
      // padi predating the field omits it → honest "—" downstream).
      commit: hello.commit,
    },
    // padi's HONEST boot time — stamped once at padi's daemon init and echoed by
    // the frozen `hello` (W2.2 added `startedAt` to `PadiHelloSchema`), so a
    // reconnect reports true uptime instead of resetting the age to `Date.now()`.
    startedAt: hello.startedAt,
    metadata: {
      surfaceVersion: hello.surfaceVersion,
      controlCoreVersion: hello.controlCoreVersion,
    },
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}
