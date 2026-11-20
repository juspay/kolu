import type { Socket } from "node:net";
import {
  buildSurfaceFace,
  type StreamingProcedure,
} from "@kolu/surface/client";
import { messageOf } from "@kolu/surface/errors";
import {
  isContractVersionCompatible,
  type SurfaceSpec,
} from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { socketDuplexLink } from "@kolu/surface/links/stdio";
import type { SurfaceClientOf, SurfaceReadFace } from "@kolu/surface/project";
import {
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
} from "@kolu/surface-daemon-supervisor/dial";
import { Effect } from "effect";
import {
  PADI_SURFACE_VERSION,
  type PadiHello,
  padiControlSibling,
  type padiControlSurface,
  padiDaemonGroup,
  type padiSurface,
  padiSurfaceSibling,
} from "./surface.ts";

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
 *  Every member is typed straight off `padiSurface.spec`: a PROCEDURE takes the
 *  ENCODED side of its input and returns `Promise<Out>`; a CELL / STREAM /
 *  EVENT / COLLECTION read returns a lazy `Stream` SYNCHRONOUSLY. Cancellation is
 *  fiber interruption — there is no signal to thread. */
export type PadiSurfaceClient = {
  readonly surface: SurfaceReadFace<typeof padiSurface.spec> &
    SurfaceCollectionsReadFace<typeof padiSurface.spec>;
};

/** The FROZEN control-core face — `client.surface.core.<verb>` over
 *  `surface/control/*`. Reached even when `padiSurface` is version-skewed,
 *  because the schemas under it never move. */
export type PadiControlClient = SurfaceClientOf<typeof padiControlSurface.spec>;

/** What a dialed padi daemon gives a caller: the erased, tag-keyed dispatch the
 *  link produced, plus the TWO typed faces built over it. Keeping the dispatch on
 *  the value is what lets a consumer build any further face it needs without
 *  re-dialing. */
export interface PadiDaemonClient {
  /** The link's tag-keyed dispatch — both faces below are built over it. */
  readonly dispatch: SurfaceDispatch;
  /** padi's versioned surface, at `surface/padi/*`. */
  readonly padi: PadiSurfaceClient;
  /** The frozen control core, at `surface/control/*`. */
  readonly control: PadiControlClient;
}

/** Build padi's two faces over one dialed dispatch — the ONE place the sibling
 *  keys and the (framework-forced, structural) `SurfaceFace` casts live, so no
 *  consumer re-derives either. */
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
 *  {@link PadiSurfaceClient}. */
export function scopePadiSurface(client: PadiDaemonClient): PadiSurfaceClient {
  return client.padi;
}

/** padi's wire identity, from its control-core `hello`. `commit` is the RUNNING
 *  padi's navigable git build (the Padi dialog's "build commit"); optional — a
 *  survivor padi predating the hello field omits it (honest "—"). */
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
 *  the CALLER's — this only opens the link and reads identity. */
export type PadiDial = {
  socket: Socket;
  client: PadiDaemonClient;
  hello: PadiHello;
  /** Release the link's protocol fibers. ASYNC and idempotent — it is the ONLY
   *  thing that frees them, so a caller that drops a dial without it leaks a
   *  fiber per attempt. Destroying the socket alone is no longer enough. */
  dispose: () => Promise<void>;
};

/**
 * Gate a padi's RUNNING `padiSurface` version against THIS build's
 * {@link PADI_SURFACE_VERSION}, throwing {@link DaemonContractSkewError} on an
 * incompatible skew (different major, or an older minor than this client needs).
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

/** Dial padi at `socketPath` and read the FROZEN control core's `hello` — the
 *  version-agnostic handshake, always reachable even at a `padiSurface` skew.
 *  Rejects with a plain Error if the socket is unreachable or `hello` is
 *  unreadable — a non-skew failure. */
export function dialPadiHello(
  socketPath: string,
): Effect.Effect<PadiDial, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
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
    // `Effect.catch` sees only typed failures, and an INTERRUPTED dial raises
    // none — so the link's release rides `Effect.onError`.
    const hello = yield* Effect.onError(
      Effect.catch(client.control.surface.core.hello(), (err) =>
        Effect.fail(
          new Error(
            `padi handshake failed — could not read control.core.hello (${messageOf(err)})`,
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
 *
 * The handshake gates on the SURFACE version (`hello.surfaceVersion` vs
 * `PADI_SURFACE_VERSION`), NOT the frozen control-core version (which never
 * moves). Three failure classes, same as connectKaval:
 *   - raw socket error → plain reject (transient);
 *   - unreadable hello → plain Error (non-skew);
 *   - genuine surface skew → `DaemonContractSkewError`.
 */
export function connectPadi(
  socketPath: string,
): Effect.Effect<PadiConnection, Error> {
  return Effect.gen(function* () {
    const { socket, client, hello, dispose } = yield* dialPadiHello(socketPath);

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
        commit: hello.commit,
      },
      startedAt: hello.startedAt,
      metadata: {
        surfaceVersion: hello.surfaceVersion,
        controlCoreVersion: hello.controlCoreVersion,
      },
      dispose: () => {
        void dispose();
      },
      onClose: (cb) => {
        if (closed) queueMicrotask(cb);
        else socket.once("close", cb);
      },
    };
  });
}
