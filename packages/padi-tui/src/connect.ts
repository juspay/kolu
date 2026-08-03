/**
 * padi-tui's dial — a thin wrapper over the SHARED `@kolu/padi/dial` kit (the same
 * `connectPadi` the kolu-server binder uses). It resolves a state-root to its
 * digest-keyed socket (the caller runs {@link resolveRunningPadiSocket}), dials it,
 * handshakes padi's FROZEN control core, and hands back the padi-SIBLING-scoped
 * client the verbs call. The kaval precedent: a daemon's package owns its dial kit.
 */

import {
  connectPadi,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi/dial";
import { Effect, type Scope } from "effect";

/** The typed `padiSurface` client the verbs speak — `.surface.terminals`,
 *  `.surface.lifecycle.create`, `.surface.git.worktreeCreate`, `.surface.activity`,
 *  … — produced by scoping the combined dialed client down to the padi sibling. */
export type PadiTuiClient = PadiSurfaceClient;

/** The transport-blind handle every `cmd*` is written against — the scoped
 *  client, and the one fact `create` needs from the transport choice: the cwd to
 *  open terminals in when this daemon shares our filesystem (a local dial,
 *  `process.cwd()`), or `undefined` when it does not (a remote host — the local
 *  path need not exist there). Every verb stays transport-blind; the receptacle
 *  carries the co-location bit rather than a parallel handle re-deriving it.
 *
 *  There is no `dispose` on it any more, and that absence is the point: the dial
 *  is an `Effect.acquireRelease`, so the link's lifetime IS the caller's scope.
 *  A command cannot forget to close it, cannot close it twice, and — the case
 *  the old `finally { conn.dispose() }` handled least well — a Ctrl+C partway
 *  through a dial still releases exactly what was acquired. */
export interface Connection {
  client: PadiTuiClient;
  localCwd: string | undefined;
}

/**
 * Dial a LOCAL padi at an ALREADY-RESOLVED socket path and hand back the
 * padi-sibling-scoped client. `connectPadi` runs the control-core handshake AND
 * the typed COMPATIBILITY gate for us, so a padi too new for this build (or a
 * padi-tui too old) fails LOUD here — a `DaemonContractSkewError` the CLI turns
 * into an honest "upgrade" line — rather than as an opaque schema-decode failure
 * on the first real call. This is the LOCAL socket dial only; the remote `--host` dial
 * lives in `hostConnect.ts` (`connectPadiTuiViaHost`), which reaches a padi on
 * another machine over ssh.
 */
export function connectPadiTui(
  socketPath: string,
): Effect.Effect<Connection, unknown, Scope.Scope> {
  return Effect.map(
    Effect.acquireRelease(connectPadi(socketPath), (conn) =>
      Effect.sync(() => conn.dispose()),
    ),
    // Scope the COMBINED dialed client to the padi sibling so `.surface.<member>`
    // resolves at `/surface/padi/<member>` — the same scope the re-serve mirrors.
    // The `"padi"` key + cast live in the dial kit (`scopePadiSurface`), not here.
    // A local dial is inherently co-located: `process.cwd()` is a real path on
    // the machine this padi runs on, so `create` opens terminals there by default.
    (conn) => ({
      client: scopePadiSurface(conn.client),
      localCwd: process.cwd(),
    }),
  );
}
