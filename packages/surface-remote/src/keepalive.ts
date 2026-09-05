/**
 * A dial's ssh DEAD-PEER policy — one concept, one module.
 *
 * Its own module rather than a section of `host.ts`, which is named after a
 * subject (`host`-string handling) and not after an axis of change: what
 * "how long may this link be silent" MEANS changes when consumers' tolerance
 * for silence changes, while `host.ts` changes when ssh's argv shapes, stderr
 * dialect, or RCE guards do. Two volatilities, two homes.
 *
 * The split is also what makes a cycle structurally impossible rather than
 * dodged by a comment: `host.ts` needs `controlMaster.ts` (to render the
 * `ControlMaster` pairs) and `controlMaster.ts` needs the policy vocabulary (to
 * key its socket by it). Both now depend DOWN on this module, which depends on
 * nothing in the package.
 *
 * Everything that makes a policy what it is lives here: the branded VALUE, the
 * ONE constructor that validates it, the interactive DEFAULT, the CEILING, the
 * derived TOLERANCE every bound and message quotes, and the whitespace-free
 * TAG that gives a policy its identity on the control socket.
 */

const sshKeepaliveBrand = Symbol("SshKeepalive");

/** One dial's ssh DEAD-PEER policy: how often ssh probes an otherwise idle
 *  connection (`ServerAliveInterval`, seconds) and how many unanswered probes it
 *  tolerates before it declares the peer dead and exits non-zero
 *  (`ServerAliveCountMax`). Total tolerance is `intervalS × countMax` seconds —
 *  the wall-clock silence a link may suffer before the session gets to redial.
 *
 *  PER-DIAL rather than one baked constant, because "how long a silence is too
 *  long" is a *consumer* judgement, not a fact about ssh. An interactive tool
 *  (kolu, drishti) wants the ~30s {@link DEFAULT_SSH_KEEPALIVE}: a host that
 *  stopped answering must stop *looking* connected while someone is watching. A
 *  CI coordinator (juspay/odu) wants the opposite for the same wire — a lane
 *  that has been compiling for twenty minutes should ride out a multi-minute
 *  network blip rather than be killed and restarted.
 *
 *  This is the ssh half of link liveness; the heartbeat half is already
 *  per-session tunable as `MakeSessionOptions.liveness` (`@kolu/surface`'s
 *  `createHeartbeat`, bounded by `MAX_HEARTBEAT_*`). They police DIFFERENT
 *  phases — see {@link MAX_SSH_KEEPALIVE_TOLERANCE_S} for why their ceilings
 *  are not the same number and must not be read as siblings.
 *
 *  NOMINAL, like the `AgentDerivation`/`AgentBinaryCache` values it travels
 *  beside: the private symbol means only {@link sshKeepalive} can produce one,
 *  so "validated" is a fact the type carries rather than an assertion each of
 *  the nine seams that accept a policy repeats — and a new ssh spawn site
 *  cannot forget to check. */
export interface SshKeepalive {
  /** `ServerAliveInterval` — seconds between keepalive probes on an idle
   *  connection. A positive integer. */
  readonly intervalS: number;
  /** `ServerAliveCountMax` — how many consecutive unanswered probes ssh
   *  tolerates before declaring the peer dead. A positive integer. */
  readonly countMax: number;
  readonly [sshKeepaliveBrand]: "ssh-keepalive";
}

/** Upper bound on a policy's TOTAL tolerance (`intervalS × countMax`). An hour
 *  of unanswered probes is not a slow keepalive — it is a link with effectively
 *  no dead-peer detection, which is the exact eternal hang this option exists to
 *  bound. Generous on purpose: a CI lane riding out a ten-minute blip is well
 *  inside it; only the pathological is rejected.
 *
 *  Per the repo's fail-fast rule an out-of-range policy CRASHES — it is never
 *  clamped to a value the caller did not ask for and would never learn about.
 *
 *  NOT the sibling of `@kolu/surface`'s `MAX_HEARTBEAT_*`, and deliberately
 *  8.6× larger: the two bound DIFFERENT questions. The heartbeat's reachable
 *  ceiling is `MAX_HEARTBEAT_INTERVAL_MS` (300s) + `MAX_HEARTBEAT_TIMEOUT_MS`
 *  (120s) = 420s, and it governs a CONNECTED link only (`isLive()` requires
 *  `phase === "connected"`). This one governs the DIALLING phases — `probing`
 *  and `provisioning`, where a cold `nix build` sits quiet for twenty minutes
 *  and the heartbeat is not watching at all — and, underneath the watchdog, it
 *  is the lower-layer transport backstop for the whole dial. So a tolerance
 *  between 420s and 3600s is legitimate and reachable; what it is reachable
 *  *during* is dialling, never a connected link. A consumer pairing the two
 *  halves (see `keepaliveOrdering.test.ts`) is bounded by the smaller ceiling
 *  for the connected half and by this one for the rest. */
export const MAX_SSH_KEEPALIVE_TOLERANCE_S = 3_600;

/** The wall-clock silence a policy tolerates — `intervalS × countMax` seconds.
 *  Derived in ONE place because the bound checks it, both error messages print
 *  it, every doc sentence quotes it, and `keepaliveOrdering.test.ts` compares it
 *  against the heartbeat's own verdict; four readings that must not drift.
 *
 *  Takes the raw pair rather than a branded {@link SshKeepalive} so
 *  {@link sshKeepalive} can bound-check BEFORE it mints one. */
export const keepaliveToleranceS = (pair: {
  readonly intervalS: number;
  readonly countMax: number;
}): number => pair.intervalS * pair.countMax;

/** The ONLY way to make an {@link SshKeepalive}: two positive integers whose
 *  product is within {@link MAX_SSH_KEEPALIVE_TOLERANCE_S}. Anything else throws
 *  HERE, where the caller wrote the literal — never on the first render, never
 *  on the first dial, and never clamped to a policy nobody asked for.
 *
 *  Integers, not merely finite positives: ssh takes whole seconds and a whole
 *  probe count, and a fractional value would render as `ServerAliveInterval=2.5`
 *  — a value OpenSSH rejects at connect time, turning a caller's typo into a
 *  per-dial spawn failure instead of one loud crash at the literal. The
 *  integers rule is also what keeps both rendered numbers whitespace-free, which
 *  the word-split `NIX_SSHOPTS` wire form depends on, and what makes
 *  {@link policyTag} a safe path component. */
export function sshKeepalive(
  intervalS: number,
  countMax: number,
): SshKeepalive {
  for (const [label, value] of [
    ["intervalS", intervalS],
    ["countMax", countMax],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `ssh keepalive: ${label} must be a positive integer — got ${value}. ` +
          "The value is rejected rather than silently coerced: a non-integer " +
          "renders as an ssh option OpenSSH refuses at connect time.",
      );
    }
  }
  const toleranceS = keepaliveToleranceS({ intervalS, countMax });
  if (toleranceS > MAX_SSH_KEEPALIVE_TOLERANCE_S) {
    throw new Error(
      `ssh keepalive: intervalS × countMax must be ≤ ${MAX_SSH_KEEPALIVE_TOLERANCE_S}s — ` +
        `got ${intervalS} × ${countMax} = ${toleranceS}s. ` +
        "A tolerance that long is not dead-peer detection at all; the policy is " +
        "rejected rather than clamped to one the caller never asked for.",
    );
  }
  return { intervalS, countMax, [sshKeepaliveBrand]: "ssh-keepalive" };
}

/** The interactive default: probe every 10s, give up after 3 misses ≈ **30s**
 *  of silence. Every consumer that does not state a policy gets exactly this,
 *  so the behaviour of every existing dial (and of the `SSH_COMMON_OPTS` const)
 *  is unchanged. */
export const DEFAULT_SSH_KEEPALIVE: SshKeepalive = sshKeepalive(10, 3);

/** The one whitespace-free spelling of a policy — the `ControlPath` suffix that
 *  gives a master its identity, so "which master is this?" has a single answer.
 *
 *  Lives HERE, with the policy, rather than in `controlMaster.ts`: the canonical
 *  spelling of a value is a property of the value, not of the one consumer that
 *  happens to key a socket by it. {@link sshKeepalive} guarantees two positive
 *  integers, so this is always short and free of whitespace and path separators
 *  — an invariant this module both states and enforces, instead of one module
 *  depending on another's promise. */
export function policyTag(keepalive: SshKeepalive): string {
  return `${keepalive.intervalS}x${keepalive.countMax}`;
}
