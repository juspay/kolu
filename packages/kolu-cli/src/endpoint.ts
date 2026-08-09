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
 *
 * ## Why the dial is a DYNAMIC import
 *
 * This module is split down the middle by WHEN each half is needed:
 *
 *  - the FLAG DECLARATIONS and the pure argv→{@link Endpoint} rules run at
 *    command-TREE-BUILD time. `cli.ts` imports them statically because it must:
 *    a shared flag has to exist before `Command.withSharedFlags` can be handed
 *    it, i.e. on every single `kolu` invocation, including `kolu web`,
 *    `kolu --help`, and a bare `kolu`. Their only dependency is `Flag`.
 *  - the DIAL ({@link connectEndpoint} / {@link withPadi} and the socket
 *    resolution under them) runs only once a terminal verb is actually
 *    executing, and reaches padi's dial graph.
 *
 * So the dial kit is loaded by `import()` INSIDE the effect — the same shape
 * `cli.ts` uses for each face — rather than by a static import at the top. A
 * static one here would be loaded transitively by `cli.ts` and would silently
 * defeat the per-face lazy-loading fence both `cli.ts` and `main.ts` state in
 * their headers: `kolu web` would pay for padi's dial graph to print its own
 * help. The two names taken from padi at the top (`PadiSurfaceClient`,
 * `LocalPadiTarget`) are `import type`s, which are erased.
 */

import type { LocalPadiTarget, PadiSurfaceClient } from "@kolu/padi/dial";
import { Effect, Option, type Scope } from "effect";
import { Flag } from "effect/unstable/cli";
import { type CliFailure, errorMessage, failure, isBlank } from "./exit.ts";

/** Everything the dial half reaches for, as a type — so the functions below can
 *  take the kit as an argument and still be checked against padi's real
 *  signatures. `typeof import(…)` is a TYPE query: it names the module without
 *  loading it. */
type PadiDialKit = typeof import("@kolu/padi/dial");

/** padi's dial kit, loaded on FIRST DIAL rather than at import time — see the
 *  header. Node's module cache makes every dial after the first one free, so
 *  this stays a plain `Effect.promise` with nothing to memoize by hand. */
const padiDialKit: Effect.Effect<PadiDialKit> = Effect.promise(
  () => import("@kolu/padi/dial"),
);

/** The root command's shared flags. Declared once, inherited by every
 *  subcommand — so the one face that does NOT dial a padi at all (`web`)
 *  refuses them rather than accepting them silently. See {@link
 *  refuseEndpointFlags}. Every other face honors all three, including `kolu
 *  mcp`, whose owned-lifetime dial resolves through the same
 *  `localPadiSocket`. */
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

/** How each endpoint arm is SPELLED on the command line — one three-row table
 *  with three readers (the blank refusal, the mutual-exclusion refusal, and the
 *  per-face refusal). */
const FLAG_NAME = {
  auto: "(none)",
  socket: "--socket",
  stateRoot: "--state-root",
  host: "--host",
} as const satisfies Record<Endpoint["kind"], string>;

/** The shape a subcommand handler reads off the root command. */
export interface EndpointFlagValues {
  readonly socket: Option.Option<string>;
  readonly stateRoot: Option.Option<string>;
  readonly host: Option.Option<string>;
}

/** WHICH padi, as data — padi's own three LOCAL arms, plus the ssh one this
 *  package adds.
 *
 *  Spelled over `LocalPadiTarget` rather than restated beside it: "the local
 *  arms ARE what `localPadiSocket` takes" is what lets the resolution (and its
 *  refusal sentences) live in `@kolu/padi/stateRoot`, beside the daemon
 *  discovery it narrows, rather than in each of this package's two dials — and
 *  written this way that is a fact the compiler checks, not a comment claiming
 *  two hand-copied unions are still the same shape. */
export type Endpoint =
  | LocalPadiTarget
  | { readonly kind: "host"; readonly ssh: string };

/** Name exactly one padi, or fail with the reason two is not a preference to
 *  resolve but a contradiction to refuse.
 *
 *  A flag that is PRESENT but empty is refused just as loudly, and this is the
 *  more dangerous of the two cases. `--socket "$SOCK"` with `$SOCK` unset is an
 *  ordinary shell accident, and padi's own client-side resolver treats `""` as
 *  "no socket given" (`stateRoot.ts`'s `!== ""` guard, which is padi's business
 *  and stays as it is) — so the empty string would fall through to discovery and
 *  dial WHATEVER daemon happens to be running. The user asked for one specific
 *  padi and would silently drive another one's terminals. Refusing at this
 *  boundary, naming the flag, is the only reading that cannot surprise: an
 *  endpoint the user spelled is never re-interpreted as an endpoint they did
 *  not. Whitespace counts as empty for the same reason (`--socket " "` is the
 *  same accident with a quoted space). */
export function endpointOf(
  flags: EndpointFlagValues,
): Effect.Effect<Endpoint, CliFailure> {
  const socket = Option.getOrUndefined(flags.socket);
  const stateRoot = Option.getOrUndefined(flags.stateRoot);
  const host = Option.getOrUndefined(flags.host);
  // The endpoint→spelling table, ONCE. It used to be written four ways in this
  // file — two positional arrays of ternaries, a record literal, and a nested
  // ternary inside a `.map` — so a fourth endpoint flag meant four coordinated
  // edits, three of them positional and silent if the order slipped.
  const given = [
    ["socket", socket],
    ["stateRoot", stateRoot],
    ["host", host],
  ] as const satisfies ReadonlyArray<
    readonly [Endpoint["kind"], string | undefined]
  >;
  // `isBlank` is `exit.ts`'s, shared with the verbs' own blank-flag gates
  // (`create`'s placement flags, `send --file`): "empty means empty, whitespace
  // included" is one rule, and a second spelling of it is how one gate comes to
  // accept what another refuses.
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

/** A face that dials no padi refuses any endpoint flag.
 *
 *  Every subcommand inherits the shared flags because that is what makes them
 *  position-independent; a face that would ignore one must say so instead.
 *  Silently ignoring a flag the user spelled is precisely the graceful
 *  degradation this repo treats as a defect.
 *
 *  `web` is the only such face — `kolu mcp` resolves its local dial through the
 *  same policy the verbs do — so there is no accept-list parameter. There used
 *  to be one, retired with the `mcp` accept-list it existed for; its last reader
 *  was the test asserting the knob was still there, which is the shape of dead
 *  code this repo's fail-fast rule calls a defect. A face that honors a SUBSET
 *  is not a thing that exists: it either dials or it does not. */
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

/** {@link Connection.localCwd}, decidable from the ENDPOINT alone — before any
 *  dial, and without a socket.
 *
 *  A LOCAL padi runs on this machine, so `process.cwd()` is a real path there (a
 *  new terminal opens where you are, the tmux convention); a REMOTE one
 *  (`--host`) runs elsewhere, so there is no local path to hand it and padi
 *  defaults to the host's home. `connectEndpoint` builds `localCwd` from this,
 *  so a verb that must refuse an impossible placement BEFORE provisioning a cold
 *  ssh box asks the same question the connection later answers, and the two
 *  answers cannot disagree — `create`'s `--worktree over --host needs --repo`
 *  used to be spelled at both altitudes, and the second spelling could never
 *  fire. */
export const localCwdOf = (endpoint: Endpoint): string | undefined =>
  endpoint.kind === "host" ? undefined : process.cwd();

/** Resolve a LOCAL endpoint to a socket path, failing loud on the edges a CLI
 *  cannot resolve for the user: no padi discovered, several with nothing naming
 *  which, or a `--state-root` that cannot be named. The verbs dial a padi that
 *  ALREADY runs; they never provision one.
 *
 *  The POLICY — and the sentences — are padi's `localPadiSocket`, not this
 *  module's: `connect.ts`'s owned-lifetime dial resolves the same thing for
 *  `kolu mcp`, and two near-copies of "zero or several padis are running, here
 *  is what to tell the user" is one fact with two homes. All that is left here
 *  is which error type the sentence rides. */
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
 *
 * Loading padi's dial kit is the FIRST step of the dial rather than of this
 * module — see the header. It is inside the returned effect, so simply HOLDING a
 * reference to this function (which `cli.ts` does, transitively through {@link
 * withPadi}, on every invocation) costs nothing.
 *
 * Not exported: {@link withPadi} is the only caller, and the only shape a verb
 * should reach for — a dial whose scope is the caller's is not something to hand
 * out unscoped.
 */
function connectEndpoint(
  endpoint: Endpoint,
): Effect.Effect<Connection, CliFailure, Scope.Scope> {
  return Effect.flatMap(
    padiDialKit,
    (padi): Effect.Effect<Connection, CliFailure, Scope.Scope> => {
      if (endpoint.kind === "host") {
        const ssh = endpoint.ssh;
        // The ssh arm is `hostConnect.ts`'s, whole — not a second spelling of
        // it. That module rebuilds padi's face from the dial's tag-keyed
        // DISPATCH (`padiClientOver`) and refuses a dispatch-less link, and its
        // header explains at length why taking `dial.client` and CASTING it is
        // the wrong route (D2/#16: per-member precision belongs to spec-derived
        // faces, never to the connector). This module used to carry that cast,
        // which meant one package held both spellings of "name the remote padi
        // face", one of them documented by the other as wrong. Now there is one.
        //
        // Loaded by `import()` for the same reason the dial kit is (see the
        // header): `hostConnect.ts` statically reaches padi's dial graph, and
        // `cli.ts` must not pay for it to print `kolu web --help`.
        //
        // Only the LIFETIME differs, and that is this module's whole job: the
        // MCP face owns its connection and disposes it itself, a verb borrows
        // one for the length of a scope.
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
              // `localCwd` is `undefined` on this arm — a remote padi runs
              // elsewhere, so our cwd need not exist there; `create` omits it
              // and lets padi default to the host's home. Read through
              // `localCwdOf` rather than written out, so the pre-dial answer and
              // this one are the same expression.
              (conn) => ({
                client: conn.client,
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
            // Scope the COMBINED dialed client to the padi sibling so
            // `.surface.<member>` resolves at `/surface/padi/<member>`.
            client: padi.scopePadiSurface(conn.client),
            // A local dial is inherently co-located — see `localCwdOf`, which is
            // where that rule is stated once for both arms and for the verbs
            // that must read it before the dial.
            localCwd: localCwdOf(endpoint),
          }),
        ),
      );
    },
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
