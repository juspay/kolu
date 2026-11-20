import type { Socket } from "node:net";
import { buildSurfaceFace } from "@kolu/surface/client";
import { isContractVersionCompatible } from "@kolu/surface/define";
import { socketDuplexLink } from "@kolu/surface/links/stdio";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  type ControlCoreProbeClient,
  type ConvergenceProbe,
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
  isNoListenerError,
  probeDaemonIdentity,
  readControlCoreHello,
} from "@kolu/surface-daemon-supervisor";
import type { DaemonLifetimeInfo } from "@kolu/surface-daemon";
import { Effect } from "effect";
import {
  kavalControlSurface,
  kavalDaemonGroup,
  PTY_HOST_CONTRACT_VERSION,
  type PtyHostClient,
  type PtyHostIdentity,
  ptyHostClientOver,
} from "kaval";
import { log } from "../log.ts";

export { isNoListenerError };

export type KavalConnection = DaemonConnection<
  PtyHostClient,
  PtyHostIdentity,
  KavalConnectionMetadata
>;

export type KavalConnectionMetadata = {
  contractVersion: string;
  dispatch: SurfaceDispatch;
  pid: number;
  lifetime?: DaemonLifetimeInfo;
};

export const HANDSHAKE_READ_DEADLINE_MS = 10_000;

function readSystemVersionBounded(
  client: PtyHostClient,
): Effect.Effect<KavalSystemVersion, Error> {
  return Effect.timeoutOrElse(client.surface.system.version({}), {
    duration: HANDSHAKE_READ_DEADLINE_MS,
    orElse: () =>
      Effect.fail(
        new Error(
          `handshake read exceeded ${HANDSHAKE_READ_DEADLINE_MS}ms deadline`,
        ),
      ),
  }).pipe(Effect.catch((err) => Effect.fail(err as Error)));
}

type KavalSystemVersion = Effect.Success<
  ReturnType<PtyHostClient["surface"]["system"]["version"]>
>;
type KavalControlHello = Effect.Success<
  ReturnType<typeof readControlCoreHello>
>;

const UNKNOWN_KAVAL_IDENTITY: PtyHostIdentity = Object.freeze({
  staleKey: "",
  navigableCommit: "",
});

interface KavalHandshake {
  hello: KavalControlHello;
  version: KavalSystemVersion;
}

interface KavalFaces {
  pty: PtyHostClient;
  control: ControlCoreProbeClient;
}

function unreadable<A, E>(
  read: Effect.Effect<A, E>,
  verb: string,
): Effect.Effect<A, Error> {
  const fail = (err: unknown): Effect.Effect<never, Error> =>
    Effect.fail(
      new Error(
        `pty-host handshake failed — could not read ${verb} (${err instanceof Error ? err.message : String(err)})`,
      ),
    );
  return Effect.catchDefect(Effect.catch(read, fail), fail);
}

function readKavalHandshake(
  faces: KavalFaces,
): Effect.Effect<KavalHandshake, Error> {
  return Effect.gen(function* () {
    const hello = yield* unreadable(
      readControlCoreHello(faces.control),
      "control.core.hello",
    );
    const version = yield* unreadable(
      readSystemVersionBounded(faces.pty),
      "system.version",
    );

    return yield* judgeKavalHandshake(hello, version);
  });
}

function judgeKavalHandshake(
  hello: KavalControlHello,
  version: KavalSystemVersion,
): Effect.Effect<KavalHandshake, Error> {
  return Effect.suspend(() => {
    const reportedContractVersion = hello.surfaceVersion;
    if (hello.surfaceVersion !== version.contractVersion) {
      return Effect.fail(
        new Error(
          `pty-host handshake failed — control-core reports surface ${hello.surfaceVersion} but system.version reports ${version.contractVersion}`,
        ),
      );
    }
    if (hello.startedAt !== version.startedAt) {
      return Effect.fail(
        new Error(
          `pty-host handshake failed — control-core reports boot ${hello.startedAt} but system.version reports ${version.startedAt}`,
        ),
      );
    }
    if (
      !isContractVersionCompatible(
        reportedContractVersion,
        PTY_HOST_CONTRACT_VERSION,
      )
    ) {
      return Effect.fail(
        new DaemonContractSkewError({
          subject: "pty-host",
          daemonVersion: reportedContractVersion,
          requiredVersion: PTY_HOST_CONTRACT_VERSION,
          pid: version.pid,
        }),
      );
    }

    return Effect.succeed({ hello, version });
  });
}

function openKavalFaces(
  socket: Socket,
  socketPath: string,
): Effect.Effect<{
  faces: KavalFaces;
  dispatch: SurfaceDispatch;
  dispose: () => Promise<void>;
}> {
  return Effect.map(
    Effect.promise(() =>
      socketDuplexLink({
        group: kavalDaemonGroup,
        socket,
        describe: `unix socket ${socketPath}`,
      }),
    ),
    (link) => {
      const control = buildSurfaceFace(kavalControlSurface, link.dispatch)
        .surface
        .core as unknown as ControlCoreProbeClient["surface"]["control"]["core"];
      return {
        faces: {
          pty: ptyHostClientOver(link.dispatch),
          control: { surface: { control: { core: control } } },
        },
        dispatch: link.dispatch,
        dispose: () => link.dispose(),
      };
    },
  );
}

function projectKavalIdentity(hello: KavalControlHello): PtyHostIdentity {
  return hello.buildId && hello.commit
    ? { staleKey: hello.buildId, navigableCommit: hello.commit }
    : UNKNOWN_KAVAL_IDENTITY;
}

/** The `lifetime` key, present only when kaval reported one. effect's
 *  `Schema.optionalKey` rejects a key that is present with `undefined` on encode
 *  (#17) — both here and on the `DaemonStatus` mirror this value feeds — so an
 *  unknown lifetime must leave the key ABSENT. */
export function optionalLifetime(lifetime: DaemonLifetimeInfo | undefined): {
  lifetime?: DaemonLifetimeInfo;
} {
  return lifetime === undefined ? {} : { lifetime };
}

export function connectKaval(
  socketPath: string,
): Effect.Effect<KavalConnection, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
    const { faces, dispatch, dispose } = yield* openKavalFaces(
      socket,
      socketPath,
    );

    const handshake = yield* Effect.onError(readKavalHandshake(faces), () =>
      Effect.promise(async () => {
        await dispose();
        socket.destroy();
      }),
    );

    const { hello, version } = handshake;
    let closed = false;
    socket.once("close", () => {
      closed = true;
    });
    return {
      client: faces.pty,
      identity: projectKavalIdentity(hello),
      startedAt: hello.startedAt,
      metadata: {
        contractVersion: hello.surfaceVersion,
        ...optionalLifetime(version.lifetime),
        pid: version.pid,
        dispatch,
      },
      dispose: () => {
        void dispose().catch((err: unknown) => {
          log.debug({ err, socketPath }, "kaval link dispose failed");
        });
        socket.destroy();
      },
      onClose: (cb) => {
        if (closed) queueMicrotask(cb);
        else socket.once("close", cb);
      },
    };
  });
}

export const probeKavalForConvergence: (
  socketPath: string,
) => Effect.Effect<ConvergenceProbe<"not-drainable"> | null, Error> =
  probeDaemonIdentity({
    capability: "not-drainable",
  });
