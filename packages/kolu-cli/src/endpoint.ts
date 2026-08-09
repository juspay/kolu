/**
 * WHICH padi a verb talks to — the one policy every terminal verb shares.
 *
 * The three spellings are the root command's SHARED flags, so Effect CLI accepts
 * them on either side of the verb name (`kolu --host pu1 create` and
 * `kolu create --host pu1` are the same parse). That is the whole reason the
 * endpoint lives on the ROOT rather than being repeated per verb: a flag
 * declared on a subcommand only parses AFTER that subcommand's name, which is
 * the positional straitjacket this CLI exists to drop.
 *
 * The absent case is the one that matters most in practice: inside a kolu
 * terminal `$PADI_SOCKET` is already stamped into the environment (the `$TMUX`
 * convention), so an agent driving its siblings passes no endpoint flag at all.
 */

import {
  connectPadi,
  dialPadiViaHost,
  type PadiSurfaceClient,
  resolvePadiStateRoot,
  padiSocketPath,
  resolveRunningPadiSocket,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { Effect, Option, type Scope } from "effect";
import { Flag } from "effect/unstable/cli";
import { type CliFailure, failure } from "./exit.ts";

/** The root command's shared flags. Declared once, inherited by every
 *  subcommand — so the two faces that do NOT dial a padi this way (`web`, which
 *  dials none, and `mcp`, whose local dial is owned by the adapter's own redial
 *  discipline and takes no explicit socket) refuse what they cannot honor rather
 *  than accepting it silently. See {@link refuseEndpointFlags}. */
export const endpointFlags = {
  socket: Flag.string("socket").pipe(
    Flag.withDescription("dial this exact padi socket path"),
    Flag.optional,
  ),
  stateRoot: Flag.string("state-root").pipe(
    Flag.withDescription(
      "dial the padi keyed to this state-root directory (dev/e2e)",
    ),
    Flag.optional,
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription(
      "reach a padi on another machine over ssh (user@host) instead of the local socket",
    ),
    Flag.optional,
  ),
} as const;

/** The shape a subcommand handler reads off the root command. */
export interface EndpointFlagValues {
  readonly socket: Option.Option<string>;
  readonly stateRoot: Option.Option<string>;
  readonly host: Option.Option<string>;
}

/** WHICH padi, as data. */
export type Endpoint =
  | { readonly kind: "auto" }
  | { readonly kind: "socket"; readonly path: string }
  | { readonly kind: "stateRoot"; readonly dir: string }
  | { readonly kind: "host"; readonly ssh: string };

/** Name exactly one padi, or fail with the reason two is not a preference to
 *  resolve but a contradiction to refuse. */
export function endpointOf(
  flags: EndpointFlagValues,
): Effect.Effect<Endpoint, CliFailure> {
  const socket = Option.getOrUndefined(flags.socket);
  const stateRoot = Option.getOrUndefined(flags.stateRoot);
  const host = Option.getOrUndefined(flags.host);
  const named = [
    socket === undefined ? undefined : "--socket",
    stateRoot === undefined ? undefined : "--state-root",
    host === undefined ? undefined : "--host",
  ].filter((n): n is string => n !== undefined);
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

/** Refuse the endpoint flags a face inherited but cannot honor.
 *
 *  Every subcommand inherits the shared flags because that is what makes them
 *  position-independent; a face that would ignore one must say so instead.
 *  `accept` names the subset this face DOES honor — `web` accepts none, `mcp`
 *  accepts `--host` only (its local dial is re-resolved per redial by the MCP
 *  adapter and takes no explicit path). Silently ignoring a flag the user
 *  spelled is precisely the graceful degradation this repo treats as a defect. */
export function refuseEndpointFlags(
  flags: EndpointFlagValues,
  command: string,
  accept: ReadonlyArray<Endpoint["kind"]> = [],
): Effect.Effect<void, CliFailure> {
  return Effect.flatMap(endpointOf(flags), (ep) => {
    if (ep.kind === "auto" || accept.includes(ep.kind)) return Effect.void;
    const spelled = {
      socket: "--socket",
      stateRoot: "--state-root",
      host: "--host",
    }[ep.kind];
    const allowed =
      accept.length === 0
        ? "it dials no padi that way"
        : `it takes only ${accept.map((k) => (k === "host" ? "--host" : k === "socket" ? "--socket" : "--state-root")).join(" / ")}`;
    return Effect.fail(
      failure(`kolu ${command} does not accept ${spelled} — ${allowed}.`),
    );
  });
}

/** The transport-blind handle every verb is written against — the padi-scoped
 *  client, and the one fact `create` needs from the transport choice: the cwd to
 *  open terminals in when this daemon shares our filesystem (a local dial,
 *  `process.cwd()`), or `undefined` when it does not (a remote host — the local
 *  path need not exist there).
 *
 *  There is no `dispose` on it, and that absence is the point: the dial is an
 *  `Effect.acquireRelease`, so the link's lifetime IS the caller's scope. A verb
 *  cannot forget to close it, cannot close it twice, and — the case a
 *  `finally { dispose() }` handles least well — a Ctrl+C partway through a dial
 *  still releases exactly what was acquired. */
export interface Connection {
  readonly client: PadiSurfaceClient;
  readonly localCwd: string | undefined;
}

/** Resolve a LOCAL endpoint to a socket path, failing loud on the two edges a
 *  CLI cannot resolve for the user: no padi discovered, or several with nothing
 *  naming which. The verbs dial a padi that ALREADY runs; they never provision
 *  one. */
function localSocketPath(
  endpoint: Endpoint & { kind: "auto" | "socket" | "stateRoot" },
): Effect.Effect<string, CliFailure> {
  return Effect.suspend(() => {
    if (endpoint.kind === "stateRoot") {
      return Effect.try({
        try: () => padiSocketPath(resolvePadiStateRoot(endpoint.dir)),
        catch: (err) =>
          failure(err instanceof Error ? err.message : String(err)),
      });
    }
    const resolved = resolveRunningPadiSocket(
      endpoint.kind === "socket" ? { socket: endpoint.path } : {},
    );
    if (resolved.kind === "many") {
      const lines = resolved.candidates
        .map((c) => `  PADI_SOCKET=${c.socket}`)
        .join("\n");
      return Effect.fail(
        failure(
          `more than one padi daemon is running on this host — set $PADI_SOCKET or pass --socket to pick one:\n${lines}`,
        ),
      );
    }
    if (resolved.kind === "none") {
      return Effect.fail(
        failure(
          "no running padi daemon found on this host — start kolu (its padi serves the terminals), or pass --socket / set $PADI_SOCKET.",
        ),
      );
    }
    return Effect.succeed(resolved.socket);
  });
}

/**
 * Dial the endpoint, SCOPED — the link lives exactly as long as the caller's
 * scope, whichever transport answered.
 *
 * Both arms gate padi's contract version before a verb makes its first call:
 * the local `connectPadi` runs the frozen control core's hello, and
 * `dialPadiViaHost` reads the remote `identity` cell through the same
 * `assertPadiSurfaceCompatible`. So a padi too new for this build — or a `kolu`
 * too old — fails with an honest upgrade line rather than an opaque
 * schema-decode error three calls later.
 *
 * A CLI is a DIAL, never a supervisor (#1313): this reads the remote hello only
 * to GATE, and never drains / converges / recycles the padi it reached.
 */
export function connectEndpoint(
  endpoint: Endpoint,
): Effect.Effect<Connection, CliFailure, Scope.Scope> {
  if (endpoint.kind === "host") {
    const ssh = endpoint.ssh;
    return Effect.map(
      Effect.acquireRelease(
        Effect.tryPromise({
          try: () => dialPadiViaHost(ssh),
          catch: (err) =>
            failure(
              `could not reach padi on ${ssh}: ${err instanceof Error ? err.message : String(err)}`,
            ),
        }),
        (dial) => Effect.sync(() => dial.dispose()),
      ),
      // `dialPadiViaHost` opens the link with padi's SIBLING surface, so the
      // face it hands back already addresses `surface/padi/<member>`. Naming it
      // is a CAST because `AgentDial.client` is the framework's deliberately
      // STRUCTURAL `SurfaceFace` — the same claim `padiClientOver` makes on the
      // local leg, and checked where it can be: the dial's own probe refuses a
      // skewed padi before this line is reached.
      //
      // `localCwd: undefined` — a remote padi runs elsewhere, so our cwd need
      // not exist there; `create` omits it and lets padi default to the host's
      // home.
      (dial) => ({
        client: dial.client as unknown as PadiSurfaceClient,
        localCwd: undefined,
      }),
    );
  }
  return Effect.flatMap(localSocketPath(endpoint), (socketPath) =>
    Effect.map(
      Effect.acquireRelease(
        Effect.mapError(connectPadi(socketPath), (err) =>
          failure(
            `could not dial padi at ${socketPath}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        ),
        (conn) => Effect.sync(() => conn.dispose()),
      ),
      (conn) => ({
        // Scope the COMBINED dialed client to the padi sibling so
        // `.surface.<member>` resolves at `/surface/padi/<member>`.
        client: scopePadiSurface(conn.client),
        // A local dial is inherently co-located: `process.cwd()` is a real path
        // on the machine this padi runs on, so `create` opens terminals there.
        localCwd: process.cwd(),
      }),
    ),
  );
}

/** Dial, run the verb, release — the shape every terminal verb's handler wraps
 *  its body in, so the link's lifetime is never a verb's concern. */
export function withPadi<A, E>(
  endpoint: Endpoint,
  use: (conn: Connection) => Effect.Effect<A, E>,
): Effect.Effect<A, E | CliFailure> {
  return Effect.scoped(Effect.flatMap(connectEndpoint(endpoint), use));
}
