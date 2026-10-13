/**
 * Pull a CONTENT-ADDRESSED closure into a host's store straight from a binary
 * cache, and root it there — the host fetches; the caller moves no bytes.
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
 *      `make-content-addressed`, `require-sigs`). A multi-gigabyte download,
 *      so it runs under the caller's progress-liveness budget: Nix's per-path
 *      `copying …` lines prove it alive, and only silence kills it.
 *   3. `nix-store --realise <path> --add-root <root> --indirect` — the commit
 *      point, shared with `deliverClosure` and `provisionAgent`.
 *
 * Nothing is evaluated, rewritten or built, on either side: the caller names
 * a path it already knows is content-addressed and published (kolu reads it
 * off agent-distro's index). An input-addressed path would be refused by an
 * untrusted daemon at step 2 — that is the caller's contract to keep.
 */

import { isLocalHost, type SshDestination } from "./host";
import type { SshKeepalive } from "./keepalive";
import {
  abortedDuring,
  causeFor,
  checkValidity,
  expiredResult,
  PROVISION_PROBE_DEADLINE_MS,
  pinGcRoot,
  type ProvisionFailure,
  type StepBudget,
} from "./nixCopy";
import { describeNixRun, runNix } from "./nixLog";

export interface PullClosureOptions {
  /** The target store's host — an ssh destination, or `localhost` for this
   *  machine's own store. */
  host: string;
  /** The binary cache the host reads the closure from (`https://…`). */
  cacheUrl: string;
  /** The exact, content-addressed store path to pull. */
  storePath: string;
  /** The GC root to commit it behind on the target. Remote: resolved against
   *  the ssh login's home when relative. Local: must be absolute. */
  rootPath: string;
  onProgress: (line: string) => void;
  /** Every stderr line of the long-running copy and commit — the owner's
   *  silence watchdog's liveness (see `ProvisionOptions.onActivity`). */
  onActivity: () => void;
  /** The progress-liveness budget of the copy and the root commit: charged on
   *  a silence kill, reset on success. */
  budget: StepBudget;
  /** Aborting group-kills the in-flight child; the result is a retryable
   *  `"network"` failure naming the step it landed in. */
  signal?: AbortSignal;
  /** The ssh dead-peer policy for every ssh the pull opens. REQUIRED. */
  keepalive: SshKeepalive;
}

/** How a pull ended:
 *
 *   - `ok` — `storePath` is valid in the target store and rooted at `rootPath`;
 *   - `uncopied` — the host's `nix copy --from <cache>` failed (not in the
 *     cache, no egress, a refused path): Nix's own words in `reason`;
 *   - `failed` — an abort, a silence kill, or the root commit failed: the
 *     `ProvisionResult` failure shape, with its retry class. */
export type PullClosureResult =
  | { readonly ok: true; readonly outPath: string }
  | { readonly ok: false; readonly kind: "uncopied"; readonly reason: string }
  | ({ readonly ok: false; readonly kind: "failed" } & ProvisionFailure);

/** Pull `storePath` from `cacheUrl` into `host`'s store and root it there —
 *  see the module header. */
export async function pullClosure(
  opts: PullClosureOptions,
): Promise<PullClosureResult> {
  const { host, keepalive, signal, storePath } = opts;
  const failed = (r: ProvisionFailure): PullClosureResult => ({
    ...r,
    kind: "failed",
  });
  if (signal?.aborted) return failed(abortedDuring(host, "the warm check"));
  const target: string | SshDestination = isLocalHost(host)
    ? "localhost"
    : { host, keepalive };
  const narrate = (line: string) => opts.onProgress(`${host}: ${line}`);

  // 1. Warm check — the host may already hold it (an earlier pull, or another
  //    profile sharing the closure).
  narrate("checking for a cached agent…");
  const held = await checkValidity(target, storePath, { signal });
  if (held === "aborted") return failed(abortedDuring(host, "the warm check"));
  if (held === "timed-out")
    narrate(
      `cached-agent check timed out after ${PROVISION_PROBE_DEADLINE_MS}ms — host may be degraded; pulling anyway`,
    );

  // 2. The host reads the cache itself.
  if (held !== "valid") {
    narrate(`pulling ${storePath} from ${opts.cacheUrl}…`);
    const copy = await runNix(
      target,
      // `-v`: per-path `copying …` lines keep a healthy download alive under
      // progress-liveness.
      ["nix", "-v", "copy", "--from", opts.cacheUrl, storePath],
      {
        narrate,
        onActivity: opts.onActivity,
        policy: opts.budget.policy(),
        signal,
      },
    );
    if (!copy.ok) {
      if (copy.kind === "aborted")
        return failed(abortedDuring(host, "the copy from the cache"));
      if (copy.kind === "lifetime-expired")
        return failed(
          expiredResult(host, "nix copy --from", opts.budget, copy),
        );
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
    opts.onActivity,
    opts.budget,
    signal,
  );
  if (bail !== null) return failed(bail);
  opts.budget.reset();
  return { ok: true, outPath: storePath };
}
