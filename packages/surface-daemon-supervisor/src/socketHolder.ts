/**
 * `readSocketHolders` — the supervisor's *ask*: which process(es) hold a given
 * unix-socket PATH.
 *
 * The endpoint's third pid-lifecycle question, beside `waitForPidGone` (is a
 * pid gone?) and the gate's `isHolderLive` (is a pid alive?): this one answers
 * *who listens on this exact socket path* — the identity source the
 * gate-less-squatter recovery needs. The gate names the daemon only while the
 * pidfile survives; when the gate is gone but a live orphan still holds the
 * rendezvous socket, the OS is the only remaining witness of who that holder
 * is.
 *
 * **Nothing here reads the OS, and nothing here folds its answer.** Until OSF4
 * this module carried its own `/proc/net/unix` parse, its own `/proc/<pid>/fd`
 * readlink walk, and its own `lsof` shell-out on darwin — the last of kolu's
 * five hand-rolled OS readers. All of it is now one `osfacts socket-holders`
 * call, and the fold from that document to the answer below lives beside the
 * parser in `osfacts-client` (`foldSocketOccupancy` /
 * `osfactsSocketHolders`), next to its structural twin `foldStartTimeReading`.
 * What is left in this package is the SHAPE OF THE ASK: a function type on
 * `EndpointSpec`, and the two answer types re-exported so a consumer wiring
 * the spec never has to reach past it.
 *
 * **Three answers, never one.** The old reader returned `SocketHolder[]` and
 * collapsed *nobody holds it*, *someone holds it whom I may not name*, and *I
 * could not look* into the same empty array — so a caller could not tell a free
 * socket from a blind read. They are now separate arms of
 * {@link SocketOccupancy}, and the recovery folds them exhaustively. Only
 * `none` is proof of freedom, and even that proof is deliberately not acted on
 * alone: the caller re-probes the socket before spawning onto it.
 *
 * **Why a LIST, not a single pid.** On linux the bound listener is the one
 * `/proc/net/unix` row that carries the path, so the answer is usually singular
 * — but a child that inherited the listening descriptor holds it too, and on
 * darwin the descriptor walk cannot tell a listener from a connected client. So
 * the leaf returns *every* pid the OS says holds the path, and the caller's
 * handshake — which self-reports the daemon's own pid — selects the true
 * listener from the set (the recovery kills only a pid the OS corroborates AND
 * the daemon named over the socket). That keeps the leaf honest on both
 * platforms without it having to guess listener-vs-client.
 *
 * **The binary path is injected, not resolved here.** `@kolu/surface-daemon-supervisor`
 * is shared spine: kolu bakes `KOLU_OSFACTS_BIN` and drishti bakes
 * `DRISHTI_OSFACTS_BIN`, and a package that knew either name would be a package
 * that belongs to one of them. Composition roots resolve their own bake once
 * (`bakedOsFactsBin(<their var>)`, which throws loudly at boot when the wrapper
 * did not bake it — no PATH fallback, here or anywhere) and pass that path to
 * `osfactsSocketHolders`.
 */

export type {
  SocketHolder,
  SocketOccupancy,
} from "osfacts-client";

import type { Effect } from "effect";
import type { OsfactsClientError, SocketOccupancy } from "osfacts-client";

/**
 * Ask the OS which processes hold `socketPath`. Injected on `EndpointSpec` so
 * the spine never learns which env var a given consumer bakes the binary into.
 *
 * An **Effect**, and its error channel is `osfacts-client`'s own union rather
 * than a wrapper of this package's making. Both halves of the answer — the
 * `SocketOccupancy` above and the three ways the read can fail — have the same
 * provenance, and this module already re-exports the success half verbatim; a
 * local error type would be a second name for facts it does not produce, and
 * every consumer would have to unwrap it to get back the tag it needed. The
 * three tags travel, so a caller can branch on *spawn vs version vs parse*
 * without a cast.
 */
export type ReadSocketHolders = (
  socketPath: string,
) => Effect.Effect<SocketOccupancy, OsfactsClientError>;
