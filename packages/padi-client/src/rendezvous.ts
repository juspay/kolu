/**
 * `@kolu/padi-client/rendezvous` — padi's identity (its **state-root**, the
 * persistent folder that holds its data) and the **digest-keyed runtime
 * rendezvous** derived from it. This is the one place the `(host, state-root)`
 * identity is spelled, so a client and the daemon compute the same paths.
 *
 * It rides the CLIENT package because it is the first thing a client does: a
 * dial needs a socket path, and `padiSocketPath(stateRoot)` is how one is named.
 * The line between this module and `@kolu/padi/stateRoot` is WHAT A CONSUMER
 * THAT NEVER INSTALLS THE DAEMON CAN REACH, not "pure vs probing": everything
 * here costs such a consumer nothing beyond `node:` builtins and
 * `resolveDaemonHome`, while the other half's closure includes kaval — discovery
 * of live padis and the kaval placement beside them — and kaval is a PTY host
 * with a compile step. `@kolu/padi/stateRoot` imports this module and adds its
 * own; the split is machine-checked by
 * `packages/padi-client/src/hydrate.closure.test.ts`, which fails the moment
 * this package's manifest closure grows.
 *
 * ── What this module is NOT: a way to FIND a running padi ────────────────────
 *
 * {@link padiSocketPath} is a RECOMPUTE from the calling process's own ambient
 * environment (`$XDG_RUNTIME_DIR`, else `/tmp/<ns>-$UID`). Construction-side
 * that is exactly right — the daemon computes where to bind. From a CLIENT it is
 * a guess, and padi's own discovery says so in as many words: `residentPadiSocket`
 * takes the resident's `state-root` MANIFEST over "any caller's own-env guess
 * (never a bare digest-path recompute, which is exactly what reproduced the
 * bug)" — juspay/kolu#1713, where a `nix run` outside a login session computed a
 * different drawer than the live daemon and hung for 30s against a padi that was
 * up the whole time.
 *
 * So a client that did not launch the daemon should be TOLD the socket, not
 * derive it: `$PADI_SOCKET` is stamped into every PTY a padi spawns, and an
 * explicit path is always accepted. The read-back that corrects a guess —
 * manifest discovery gated on a live pid holder — needs kaval's own-dir and
 * socket-inode checks, which is why it stayed in `@kolu/padi/stateRoot` and is
 * out of reach for a consumer that hydrates this package alone. Recomputing is
 * safe only when the client and the daemon share a launch context.
 *
 * Two kinds of location, deliberately split (each mechanic exists because a
 * reviewer constructed the failure without it — see padi.mdx §identity):
 *
 *   - **The state-root is PERSISTENT.** It survives reboots — restore depends on
 *     it. **Bind resolution requires an explicit path** (`--state-root` /
 *     `KOLU_PADI_STATE_DIR`) — there is no silent default (#1334: a bare launch
 *     must never inherit production's chair). Production wrappers export the
 *     well-known path via {@link productionPadiStateRoot}'s formula; dev/e2e set a
 *     private dir. A remote client never invents the path — the host-side
 *     wrapper or binder supplies it.
 *
 *   - **The socket + gate + manifest are EPHEMERAL.** They live in the
 *     boot-wiped runtime dir (`$XDG_RUNTIME_DIR/padi-<digest>/`,
 *     `kaval-<digest>/`), named by a {@link padiDigest} of the state-root path.
 *     Boot-wiping is load-bearing: the pid gate's liveness check reads a
 *     `kill(pid,0)` EPERM as "alive" (`acquirePidGate` via
 *     `@kolu/surface-daemon`), so a stale gate must never outlive the process
 *     that wrote it — which the runtime dir's boot wipe guarantees and a
 *     persistent state-root would not. The digest also keeps socket paths short
 *     no matter how deep the state-root sits.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveDaemonHome } from "@kolu/surface-daemon";

/** The socket filename padi serves inside its `padi-<digest>/` runtime dir. */
export const PADI_SOCK_FILE = "padi.sock";

/** The gate filename padi's single-instance lock claims, beside the socket. */
export const PADI_GATE_FILE = "padi.pid";

/** The well-known **production** state-root formula ON the host —
 *  `$HOME/.local/state/padi` (the OS passwd home if `$HOME` is unset). Persistent
 *  (survives reboots), distinct from kolu-server's `~/.config/kolu` config (session
 *  layout is *state*, not user *config*).
 *
 *  **Not a bind default** — {@link resolvePadiStateRoot} never falls back here
 *  (juspay/kolu#1334). Production nix wrappers export this path as
 *  `KOLU_PADI_STATE_DIR`; read-only discovery uses it only to name a sensible
 *  socket when no daemon is found. Deliberately **env-insensitive** — it does
 *  NOT honor `$XDG_STATE_HOME` (set in some launch contexts, unset in others), so
 *  two contexts can't compute two "production" paths and split identity. `$HOME`
 *  is stable across every context. Crashes if no home resolves. */
export function productionPadiStateRoot(): string {
  const home = process.env.HOME || homedir();
  if (home) return join(resolve(home), ".local", "state", "padi");
  throw new Error(
    "padi: cannot resolve the production state-root formula — set $HOME, or pass " +
      "an explicit --state-root / KOLU_PADI_STATE_DIR.",
  );
}

/** Resolve the state-root a padi process should **bind** to. Requires an explicit
 *  override (`--state-root`) or `KOLU_PADI_STATE_DIR` — there is no silent default
 *  (juspay/kolu#1334: bare launch must not inherit production's identity). Always
 *  absolute, so the digest is stable. The binder (kolu-server) resolves the SAME
 *  way and pins the result when spawning, so a supervised padi and its supervisor
 *  never disagree on the identity. Production wrappers and `pnpm dev` / tests each
 *  set the env; a bare process without either crashes with one line. */
export function resolvePadiStateRoot(override?: string): string {
  const explicit = override ?? process.env.KOLU_PADI_STATE_DIR;
  if (!explicit) {
    throw new Error(
      "KOLU_PADI_STATE_DIR must be set (or pass --state-root). Relative paths " +
        "are resolved against cwd. The nix-built kolu/padi wrappers, `pnpm dev`, " +
        "and the test harness each set their own — bare launches are rejected " +
        "to avoid clobbering production's padi state-root (juspay/kolu#1334).",
    );
  }
  return resolve(explicit);
}

/** A short, stable digest of the state-root path — the rendezvous key. A hex
 *  slice of a sha256 of the ABSOLUTE path: distinct state-roots yield distinct
 *  digests (the #1313 isolation property — two padis never touch each other's
 *  kaval), an identical state-root yields an identical digest (a re-boot dials
 *  the same daemon). Deliberately does NOT `realpath` (the dir may not exist at
 *  first boot, and a symlink resolving later must not change a live daemon's
 *  key); callers pass a resolved absolute path. */
export function padiDigest(stateRoot: string): string {
  return createHash("sha256")
    .update(resolve(stateRoot))
    .digest("hex")
    .slice(0, 16);
}

/** Pure padi runtime home for a state-root — full `ResolvedDaemonHome` so
 *  construction can take gate + socket from one resolve. Overrides (CLI
 *  `--socket`) are absorbed via `socketOverride`. */
export function padiRuntimeHome(stateRoot: string, socketOverride?: string) {
  return resolveDaemonHome({
    app: "padi",
    placement: "runtime",
    instance: padiDigest(stateRoot),
    socketOverride,
  });
}

/** The socket path padi serves on: `$XDG_RUNTIME_DIR/padi-<digest>/padi.sock`
 *  (override wins verbatim). Takes the STATE-ROOT and derives the digest itself —
 *  the same shape as {@link padiKavalSocketPath}, so a caller never hand-threads a
 *  digest (and can't pass a state-root where a digest was expected). Path algebra
 *  is {@link resolveDaemonHome} with `instance` = the digest. */
export function padiSocketPath(stateRoot: string, override?: string): string {
  return padiRuntimeHome(stateRoot, override).socketPath;
}

/** padi's single-instance gate beside a socket — for override/discovered
 *  sockets where only the socket path is known. Construction uses
 *  {@link padiRuntimeHome}.gatePath instead. */
export function padiGatePath(socketPath: string): string {
  return join(dirname(socketPath), PADI_GATE_FILE);
}
