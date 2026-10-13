/**
 * Pull a published closure into a host's store straight from a binary cache,
 * and root it there — the host fetches; the caller moves no bytes.
 *
 * The route, three steps, each run AT the target (over ssh for a remote host,
 * directly for `localhost`):
 *
 *   1. `nix-store --check-validity <path>` — the ask-only warm check (it never
 *      substitutes). Present ⇒ skip the copy.
 *   2. `nix copy --from <cacheUrl> <path>` — the host reads the cache itself.
 *      `--from` names a store to READ, so no trust setting filters it (unlike
 *      `--substituters`, which an untrusted user's daemon drops), and a
 *      content-addressed path is accepted by every Nix daemon with no
 *      signature, no key and no `trusted-users` entry (the Nix manual:
 *      `make-content-addressed`, `require-sigs`). An INPUT-addressed path
 *      (`signedBy`) is taken only when the host's Nix trusts its signature:
 *      the login is in `trusted-users` (then `--extra-trusted-public-keys`
 *      names the key), or the key is already in the host's
 *      `trusted-public-keys`. `nix-command` is enabled on the command line,
 *      so the host needs no Nix setting for it either.
 *      A multi-gigabyte download, so it runs under the copy's fixed
 *      progress-liveness bound (`PROVISION_COPY_SILENCE_MS`): Nix's per-path
 *      `copying …` lines prove it alive, and only silence kills it.
 *   3. `nix-store --realise <path> --add-root <root> --indirect` — the commit
 *      point, shared with `provisionAgent`, under a fresh provisioning
 *      budget.
 *
 * Nothing is evaluated, rewritten or built, on either side: the caller names
 * a path it already knows is published — content-addressed (no trust asked
 * anywhere), or input-addressed and signed (`signedBy`: the trust above). A
 * content-addressed rewrite is no option for a macOS host: rewriting a Mach-O
 * invalidates its code signature, and macOS kills it on launch.
 */

import { isLocalHost, type SshDestination } from "./host";
import type { SshKeepalive } from "./keepalive";
import {
  causeFor,
  checkValidity,
  copyPolicy,
  makeStepBudget,
  PROVISION_PROBE_DEADLINE_MS,
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
  pinGcRoot,
  type ProvisionFailure,
} from "./nixCopy";
import { describeNixRun, runNix } from "./nixLog";
import { describeExit } from "./process";

export interface PullClosureOptions {
  /** The target store's host — an ssh destination, or `localhost` for this
   *  machine's own store. */
  host: string;
  /** The binary cache the host reads the closure from (`https://…`). */
  cacheUrl: string;
  /** The exact store path to pull. */
  storePath: string;
  /** For an INPUT-addressed `storePath`: the public key of the signature the
   *  host's Nix must trust to take it. Absent for a content-addressed path,
   *  which needs none. */
  signedBy?: string;
  /** The GC root to commit it behind on the target. Remote: resolved against
   *  the ssh login's home when relative. Local: must be absolute. */
  rootPath: string;
  onProgress: (line: string) => void;
  /** The ssh dead-peer policy for every ssh the pull opens. REQUIRED. */
  keepalive: SshKeepalive;
}

/** How a pull ended:
 *
 *   - `ok` — `storePath` is valid in the target store and rooted at `rootPath`;
 *   - `uncopied` — the host's `nix copy --from <cache>` failed (not in the
 *     cache, no egress, a refused path): Nix's own words in `reason`;
 *   - `failed` — a silence kill, a dropped ssh, or the root commit failed: the
 *     `ProvisionResult` failure shape, with its retry class. */
export type PullClosureResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "uncopied"; readonly reason: string }
  | ({ readonly ok: false; readonly kind: "failed" } & ProvisionFailure);

/** Pull `storePath` from `cacheUrl` into `host`'s store and root it there —
 *  see the module header. */
export async function pullClosure(
  opts: PullClosureOptions,
): Promise<PullClosureResult> {
  const { host, keepalive, storePath } = opts;
  const failed = (r: ProvisionFailure): PullClosureResult => ({
    ...r,
    kind: "failed",
  });
  const target: string | SshDestination = isLocalHost(host)
    ? "localhost"
    : { host, keepalive };
  const narrate = (line: string) => opts.onProgress(`${host}: ${line}`);

  // 1. Warm check — the host may already hold it (an earlier pull, or another
  //    profile sharing the closure).
  narrate(`checking whether the host already holds ${storePath}…`);
  const held = await checkValidity(target, storePath, { signal: undefined });
  if (held === "timed-out")
    narrate(
      `the check timed out after ${PROVISION_PROBE_DEADLINE_MS}ms — host may be degraded; pulling anyway`,
    );

  // 2. The host reads the cache itself.
  if (held !== "valid") {
    narrate(`pulling ${storePath} from ${opts.cacheUrl}…`);
    const copy = await runNix(
      target,
      // `--extra-experimental-features nix-command`: `nix copy` is the new
      // CLI, and a stock host Nix ships with it off — a client-side parse
      // gate any login may lift, so the host needs no setting for it (it also
      // makes the `--log-format` `runNix` adds legal). `-v`: per-path
      // `copying …` lines keep a healthy download alive under
      // progress-liveness — the COPY bound, not the root commit's budget: a
      // slow multi-gigabyte download is not a dead one.
      [
        "nix",
        "--extra-experimental-features",
        "nix-command",
        "-v",
        "copy",
        ...(opts.signedBy === undefined
          ? []
          : ["--extra-trusted-public-keys", opts.signedBy]),
        "--from",
        opts.cacheUrl,
        storePath,
      ],
      {
        narrate,
        onActivity: () => {},
        policy: copyPolicy(),
        signal: undefined,
      },
    );
    if (!copy.ok) {
      if (copy.kind === "lifetime-expired")
        return failed({
          ok: false,
          reason: `${host}: 'nix copy --from ${opts.cacheUrl}' ${describeExit(copy)}`,
          cause: "network",
        });
      // A transport failure (the ssh to the host dropped) is the dial's to
      // retry, not a statement about the cache.
      if (causeFor(copy) === "network")
        return failed({
          ok: false,
          reason: `${host}: lost the connection while pulling from ${opts.cacheUrl}: ${describeNixRun(copy)}`,
          cause: "network",
        });
      return { ok: false, kind: "uncopied", reason: describeNixRun(copy) };
    }
    narrate(`pulled ${storePath}`);
  } else narrate(`already holds ${storePath} — skipped copy`);

  // 3. Commit behind the root.
  const bail = await pinGcRoot(
    host,
    keepalive,
    storePath,
    opts.rootPath,
    opts.onProgress,
    () => {},
    makeStepBudget(PROVISION_STEP_SILENCE_BASE_MS, PROVISION_STEP_MAX_EXPIRIES),
    undefined,
  );
  return bail === null ? { ok: true } : failed(bail);
}
