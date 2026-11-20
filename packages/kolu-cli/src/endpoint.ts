import type { LocalPadiTarget } from "@kolu/padi/stateRoot";
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { Effect, Option, type Scope } from "effect";
import { Flag } from "effect/cli";
import { type CliFailure, errorMessage, failure, isBlank } from "./exit.ts";

type PadiDialKit = typeof import("@kolu/padi-client/dial") &
  typeof import("@kolu/padi/stateRoot");

const padiDialKit: Effect.Effect<PadiDialKit> = Effect.promise(async () => {
  const [dial, rendezvous] = await Promise.all([
    import("@kolu/padi-client/dial"),
    import("@kolu/padi/stateRoot"),
  ]);
  return { ...dial, ...rendezvous };
});

export const endpointFlags = {
  socket: Flag.String("socket").pipe(
    Flag.withDescription("dial this exact padi socket path"),
    Flag.optional,
  ),
  stateRoot: Flag.String("state-root").pipe(
    Flag.withDescription(
      "dial the padi keyed to this state-root directory (dev/e2e)",
    ),
    Flag.optional,
  ),
  host: Flag.String("host").pipe(
    Flag.withDescription(
      "reach a padi on another machine over ssh (user@host) instead of the local socket",
    ),
    Flag.optional,
  ),
} as const;

const FLAG_NAME = {
  auto: "(none)",
  socket: "--socket",
  stateRoot: "--state-root",
  host: "--host",
} as const satisfies Record<Endpoint["kind"], string>;

export interface EndpointFlagValues {
  readonly socket: Option.Option<string>;
  readonly stateRoot: Option.Option<string>;
  readonly host: Option.Option<string>;
}

export type Endpoint =
  | LocalPadiTarget
  | { readonly kind: "host"; readonly ssh: string };

export function endpointOf(
  flags: EndpointFlagValues,
): Effect.Effect<Endpoint, CliFailure> {
  const socket = Option.getOrUndefined(flags.socket);
  const stateRoot = Option.getOrUndefined(flags.stateRoot);
  const host = Option.getOrUndefined(flags.host);
  const given = [
    ["socket", socket],
    ["stateRoot", stateRoot],
    ["host", host],
  ] as const satisfies ReadonlyArray<
    readonly [Endpoint["kind"], string | undefined]
  >;
  const blank = given
    .filter(([, v]) => v !== undefined && isBlank(v))
    .map(([k]) => FLAG_NAME[k]);
  if (blank.length > 0) {
    return Effect.fail(
      failure(
        `${blank.join(" and ")} was passed with an empty value — an unset shell variable, most likely. Name a padi, or drop the flag entirely; kolu will not quietly fall back to whichever daemon it discovers.`,
      ),
    );
  }
  const named = given
    .filter(([, v]) => v !== undefined)
    .map(([k]) => FLAG_NAME[k]);
  if (named.length > 1) {
    return Effect.fail(
      failure(
        `${named.join(" and ")} are mutually exclusive — --host reaches a REMOTE padi over ssh, --socket / --state-root name a LOCAL one. Pass just one.`,
      ),
    );
  }
  if (socket !== undefined) {
    return Effect.succeed({ kind: "socket", path: socket });
  }
  if (stateRoot !== undefined) {
    return Effect.succeed({ kind: "stateRoot", dir: stateRoot });
  }
  if (host !== undefined) return Effect.succeed({ kind: "host", ssh: host });
  return Effect.succeed({ kind: "auto" });
}

export function refuseEndpointFlags(
  flags: EndpointFlagValues,
  command: string,
): Effect.Effect<void, CliFailure> {
  return Effect.flatMap(endpointOf(flags), (ep) =>
    ep.kind === "auto"
      ? Effect.void
      : Effect.fail(
          failure(
            `kolu ${command} does not accept ${FLAG_NAME[ep.kind]} — it dials no padi that way.`,
          ),
        ),
  );
}

export interface Connection {
  readonly client: PadiSurfaceClient;
  readonly localCwd: string | undefined;
}

export const localCwdOf = (endpoint: Endpoint): string | undefined =>
  endpoint.kind === "host" ? undefined : process.cwd();

function localSocketPath(
  padi: PadiDialKit,
  endpoint: LocalPadiTarget,
): Effect.Effect<string, CliFailure> {
  return Effect.suspend(() => {
    const resolved = padi.localPadiSocket(endpoint);
    return resolved.kind === "ok"
      ? Effect.succeed(resolved.socket)
      : Effect.fail(failure(resolved.message));
  });
}

function connectEndpoint(
  endpoint: Endpoint,
): Effect.Effect<Connection, CliFailure, Scope.Scope> {
  return Effect.flatMap(
    padiDialKit,
    (padi): Effect.Effect<Connection, CliFailure, Scope.Scope> => {
      if (endpoint.kind === "host") {
        const ssh = endpoint.ssh;
        return Effect.flatMap(
          Effect.promise(() => import("./hostConnect.ts")),
          ({ connectKoluCliViaHost }) =>
            Effect.map(
              Effect.acquireRelease(
                Effect.mapError(connectKoluCliViaHost(ssh), (err) =>
                  failure(`could not reach padi on ${ssh}: ${err.message}`),
                ),
                (conn) => Effect.sync(() => conn.dispose()),
              ),
              (conn) => ({
                client: conn.client.core,
                localCwd: localCwdOf(endpoint),
              }),
            ),
        );
      }
      return Effect.flatMap(localSocketPath(padi, endpoint), (socketPath) =>
        Effect.map(
          Effect.acquireRelease(
            Effect.mapError(padi.connectPadi(socketPath), (err) =>
              failure(
                `could not dial padi at ${socketPath}: ${errorMessage(err)}`,
              ),
            ),
            (conn) => Effect.sync(() => conn.dispose()),
          ),
          (conn) => ({
            client: padi.scopePadiSurface(conn.client),
            localCwd: localCwdOf(endpoint),
          }),
        ),
      );
    },
  );
}

export function withPadi<A, E>(
  endpoint: Endpoint,
  use: (conn: Connection) => Effect.Effect<A, E>,
): Effect.Effect<A, E | CliFailure> {
  return Effect.scoped(Effect.flatMap(connectEndpoint(endpoint), use));
}
