/**
 * `@kolu/padi/dial` — the CLIENT-SIDE DIAL KIT for a padi daemon.
 *
 * One place spells how a client reaches padi: resolve a state-root to its
 * digest-keyed socket (re-exported from {@link ./stateRoot.ts}), dial it, and
 * handshake the FROZEN control core — hello · version compare · typed skew
 * refusal — returning the live, version-checked connection whose `.client` is the
 * COMBINED daemon client — one dispatch carrying BOTH siblings' tags, with a
 * typed face over each (`.control.surface.core.*` and `.padi.surface.*`).
 * This is the kaval precedent: a daemon's package owns the dial
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
  buildSurfaceFace,
  type StreamingProcedure,
} from "@kolu/surface/client";
import {
  isContractVersionCompatible,
  type Surface,
  type SurfaceSpec,
} from "@kolu/surface/define";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { socketDuplexLink } from "@kolu/surface/links/stdio";
import type { SurfaceClientOf, SurfaceReadFace } from "@kolu/surface/project";
import {
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
} from "@kolu/surface-daemon-supervisor";
import { type AgentDial, dialAgentOnce } from "@kolu/surface-remote";
import { Effect } from "effect";
import { composeSpawnEnv } from "kolu-pty";
import {
  PADI_SURFACE_VERSION,
  padiControlSibling,
  type padiControlSurface,
  padiDaemonGroup,
  type PadiHello,
  type padiSurface,
  padiSurfaceSibling,
} from "./surface.ts";

// The client-side rendezvous resolve is part of the dial kit — `state-root →
// digest → socket`, plus the read-only multi-daemon discovery a flag-less client
// labels what it finds with. Re-exported through this entry so a consumer reaches
// the whole dial kit from ONE import, without pulling in the node-only
// terminal-domain `@kolu/padi/assembly` barrel (the daemon runtime) just to
// compute a socket path.
export {
  discoverPadiDaemons,
  type LocalPadiSocket,
  type LocalPadiFlags,
  localPadiSocket,
  type LocalPadiTarget,
  localPadiTargetOf,
  type PadiDaemon,
  type PadiSocketResolution,
  padiSocketPath,
  residentPadiSocket,
  resolvePadiStateRoot,
  resolveRunningPadiSocket,
} from "./stateRoot.ts";

// The client-side terminal WATCH kit — `watchTerminals` + the ONE
// block-on-a-condition engine (`awaitTerminalCondition`, which takes the
// condition as data and carries the `--settled` quiescence conjunct and the
// `--snapshot` screen stamp), the two named waits that are spellings of it
// (`awaitAgentState` · `awaitOutputSettled` — named because their met payloads
// ARE the MCP tools' wire frames), plus `awaitWatchEvents` (the
// standing-subscription drain, which differs in kind: it drains a padi-side
// BUFFER, so the gaps between calls are not holes) and the bucket vocabulary
// they predicate on — rides the dial entry too: the same "a daemon's package
// owns the client kit its consumers share" rule, and every consumer (padi-tui's
// `wait`/`watch`, the kolu MCP face's `wait_agentState`/`wait_outputSettled`,
// `kolu wait`'s three `--until` forms) already imports this entry to dial.
// The `match:` form has NO named wrapper — `kolu wait` is its one consumer and
// calls the engine directly; see the note at the foot of `cliClient/watch.ts`.
export {
  activeAgent,
  type AgentStateOutcome,
  isWaitState,
  PADI_LINK_CLOSED,
  awaitAgentState,
  awaitOutputSettled,
  awaitTerminalCondition,
  awaitWatchEvents,
  type ConditionMet,
  type OutputSettledOutcome,
  type TerminalCondition,
  type TerminalConditionOutcome,
  type WatchEventsOutcome,
  WAIT_STATES,
  type WaitState,
  type WatchHandlers,
  watchAgentStates,
  watchTerminals,
} from "./cliClient/watch.ts";

// ── Types ────────────────────────────────────────────────────────────────────

/** The collection READ verbs, typed off a spec.
 *
 *  The framework's `SurfaceReadFace` deliberately declines collections: it exists
 *  for a PROJECTION's `deps`, which consumes cells and streams and never walks a
 *  collection. padi's clients do — `watchTerminals` enumerates `terminals.keys`,
 *  the TUI reads a record by key — so the two read verbs are spelled here, once,
 *  in the same shape and on the same sides the face actually mints them
 *  (`buildSurfaceFace` emits `keys`/`get`/`deltas` as streaming refs). Keys and
 *  values are DECODED on both legs, per S3's rule: a collection key is an
 *  identity in the client's own key set, not a pure forwarded argument. */
type SurfaceCollectionsReadFace<S extends SurfaceSpec> = {
  [K in keyof S["collections"] & string]: {
    keys: StreamingProcedure<
      undefined,
      readonly NonNullable<S["collections"]>[K]["keySchema"]["Type"][]
    >;
    get: StreamingProcedure<
      { key: NonNullable<S["collections"]>[K]["keySchema"]["Type"] },
      NonNullable<S["collections"]>[K]["schema"]["Type"]
    >;
  };
};

/** The padi-SIBLING face — `client.surface.<member>.<verb>` over `surface/padi/*`.
 *
 *  Spec-derived (D2): every member is typed straight off `padiSurface.spec`, so a
 *  schema edit is a compile error at each call site rather than a runtime
 *  surprise. Two shape changes every consumer sees, both from the Effect port:
 *  a PROCEDURE takes the ENCODED side of its input and returns `Promise<Out>`;
 *  a CELL / STREAM / EVENT / COLLECTION read returns a lazy `Stream`
 *  SYNCHRONOUSLY (was `Promise<AsyncIterable<…>>` plus an `AbortSignal` option).
 *  Cancellation is fiber interruption (D10/#18) — there is no signal to thread
 *  and none to forget. */
export type PadiSurfaceClient = {
  readonly surface: SurfaceReadFace<typeof padiSurface.spec> &
    SurfaceCollectionsReadFace<typeof padiSurface.spec>;
};

/** The FROZEN control-core face — `client.surface.core.<verb>` over
 *  `surface/control/*`. Reached even when `padiSurface` is version-skewed,
 *  because the schemas under it never move. */
export type PadiControlClient = SurfaceClientOf<typeof padiControlSurface.spec>;

/** What a dialed padi daemon gives a caller: the erased, tag-keyed dispatch the
 *  link produced, plus the TWO typed faces built over it.
 *
 *  Under oRPC this was ONE `ContractRouterClient` of the combined contract, and
 *  `.surface.control` / `.surface.padi` were nested namespaces on it. The Effect
 *  wire namespace is FLAT, so a sibling is a TAG PREFIX, not a nesting: each
 *  sibling's face is built from its own `Surface` value over the SAME dispatch
 *  (S1's sibling algebra, S3's `buildSurfaceFace`). Keeping the dispatch on the
 *  value is what lets a consumer build any further face it needs without
 *  re-dialing — and it is the one thing a re-nested client could not have
 *  handed back. */
export interface PadiDaemonClient {
  /** The link's tag-keyed dispatch — both faces below are built over it. */
  readonly dispatch: SurfaceDispatch;
  /** padi's versioned surface, at `surface/padi/*`. */
  readonly padi: PadiSurfaceClient;
  /** The frozen control core, at `surface/control/*`. */
  readonly control: PadiControlClient;
}

/** Build padi's two faces over one dialed dispatch — the ONE place the sibling
 *  keys and the (framework-forced, deliberately STRUCTURAL) `SurfaceFace` casts
 *  live, so no consumer re-derives either.
 *
 *  Both faces come from the SIBLING surface values `surface.ts` composes, never
 *  from a hand-spliced prefix: the serving side and the dialing side therefore
 *  read their tags off ONE expression, and a mis-scoped dispatch is impossible
 *  rather than merely unlikely. */
export function padiClientOver(dispatch: SurfaceDispatch): PadiDaemonClient {
  return {
    dispatch,
    padi: buildSurfaceFace(
      padiSurfaceSibling,
      dispatch,
    ) as unknown as PadiSurfaceClient,
    control: buildSurfaceFace(
      padiControlSibling,
      dispatch,
    ) as unknown as PadiControlClient,
  };
}

/** Narrow a dialed daemon client to padi's own surface face — the LAST mile of
 *  "reaching padi's surface", owned by the kit that owns
 *  {@link PadiSurfaceClient}. A field read now rather than a re-wrap: the faces
 *  are built once, at dial, over the dispatch they share. Kept as a FUNCTION so
 *  every consumer that asks for "the padi client" still spells the same call. */
export function scopePadiSurface(client: PadiDaemonClient): PadiSurfaceClient {
  return client.padi;
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
  /** `Effect.Effect.Success`, not `Awaited` — `Awaited<Effect<A>>` is `Effect<A>`,
   *  so the old spelling would keep compiling and silently mean the effect. */
  socket: Effect.Success<ReturnType<typeof dialSocket>>;
  client: PadiDaemonClient;
  hello: PadiHello;
  /** Release the link's protocol fibers. ASYNC and idempotent — it is the ONLY
   *  thing that frees them, so a caller that drops a dial without it leaks a
   *  fiber per attempt. Destroying the socket alone is no longer enough. */
  dispose: () => Promise<void>;
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

// ── The dial + control-core handshake ─────────────────────────────────────────

/** Dial padi at `socketPath` and read the FROZEN control core's `hello` — the
 *  version-agnostic handshake, always reachable even at a `padiSurface` skew (the
 *  control-core schemas never move). Mirrors `connectKaval` on link choice:
 *  `dialSocket` + `stdioLink` (NOT `unixSocketLink`, which hides the socket's
 *  `close` event the endpoint's `onClose` needs). Rejects with a plain Error if
 *  the socket is unreachable or `hello` is unreadable — a non-skew failure. */
export function dialPadiHello(
  socketPath: string,
): Effect.Effect<PadiDial, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
    // ONE link over the WHOLE daemon group, then both sibling faces over its one
    // dispatch — the flat-tag successor of the combined-contract client.
    // `socketDuplexLink` is a Promise-shaped constructor by contract, so it is
    // LIFTED. The socket is BOTH halves so its `close` stays observable (see the
    // docstring). No readiness proof, deliberately: this is the LOCAL-rendezvous
    // residual `socketDuplexLink` names (juspay/kolu#2101) — padi's epoch safety
    // on this path is owed by the converge-before-dial discipline that governs
    // every caller (the binder's `converge(ep)`, the front's own pre-step),
    // never by a banner over a pipe that never leaves this box.
    const link = yield* Effect.promise(() =>
      socketDuplexLink({
        group: padiDaemonGroup,
        socket,
        describe: `unix socket ${socketPath}`,
      }),
    );
    const client = padiClientOver(link.dispatch);
    const dispose = async (): Promise<void> => {
      await link.dispose();
      socket.destroy();
    };
    // `onError`, not `catch`: an INTERRUPTED dial releases the link too — a
    // `catch` sees only typed failures and would leak the protocol fibers on the
    // abandonment path.
    const hello = yield* Effect.onError(
      Effect.catch(client.control.surface.core.hello(), (err) =>
        Effect.fail(
          new Error(
            `padi handshake failed — could not read control.core.hello (${(err as Error).message})`,
          ),
        ),
      ),
      () => Effect.promise(dispose),
    );
    return { socket, client, hello, dispose };
  });
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
export function connectPadi(
  socketPath: string,
): Effect.Effect<PadiConnection, Error> {
  return Effect.gen(function* () {
    const { socket, client, hello, dispose } = yield* dialPadiHello(socketPath);

    // The dial kit's one compatibility judgement (shared with `padi-tui --host`'s
    // ssh probe). This connect OWNS the link, so tear it down before surfacing a
    // skew — the remote probe's teardown is `dialAgentOnce`'s, so it just re-fails.
    yield* Effect.onError(
      Effect.suspend(() => {
        assertPadiSurfaceCompatible(hello.surfaceVersion);
        return Effect.void;
      }),
      () => Effect.promise(dispose),
    );

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
      // `DaemonConnection.dispose` is a synchronous seam (the supervisor calls it
      // from teardown paths that cannot await), so the link release is FIRED here
      // rather than awaited. It is idempotent and its only failure mode is a link
      // already gone — but it must never replace the reason a caller is tearing
      // down, so a rejection is swallowed at this one edge, deliberately and
      // visibly, instead of becoming an unhandled rejection.
      dispose: () => {
        void dispose().catch(() => {
          /* best-effort — a link already disposed is fine */
        });
      },
      onClose: (cb) => {
        if (closed) queueMicrotask(cb);
        else socket.once("close", cb);
      },
    };
  });
}
