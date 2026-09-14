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
 * derived TOLERANCE every bound and message quotes, the {@link KeepalivePlan}
 * SNAPSHOT everything downstream actually renders from, and the whitespace-free
 * TAG that gives a policy its identity on the control socket.
 */

const sshKeepaliveBrand = Symbol("SshKeepalive");
const keepalivePlanBrand = Symbol("KeepalivePlan");

/** One dial's ssh DEAD-PEER policy: how often ssh probes an otherwise idle
 *  connection (`ServerAliveInterval`, seconds) and how many unanswered probes it
 *  tolerates before it declares the peer dead and exits non-zero
 *  (`ServerAliveCountMax`). Total tolerance is `intervalS × countMax` seconds —
 *  the wall-clock silence a link may suffer before the session gets to redial.
 *
 *  PER-DIAL rather than one baked constant, because "how long may ssh get no
 *  answer before it gives up on the transport" is a *consumer* judgement, not a
 *  fact about ssh. An interactive tool (kolu, drishti) wants the ~30s
 *  {@link DEFAULT_SSH_KEEPALIVE}: a host that stopped answering must stop
 *  *looking* connected while someone is watching. A CI coordinator (juspay/odu)
 *  wants the opposite for the same wire — an unattended dial should not have its
 *  ssh torn down because a peer took 40s to answer a probe.
 *
 *  Read what this is NARROWLY: it bounds how long a DEAD or HALF-OPEN ssh
 *  TRANSPORT takes to be noticed and exited — not how long a lane survives an
 *  interruption. It is the loosest of four independent bounds on link silence
 *  and moves none of the others; they are enumerated once, at
 *  `SshConnectorOptions.keepalive`, and pinned by `keepaliveOrdering.test.ts`.
 *
 *  NOMINAL, like the `AgentDerivation`/`AgentBinaryCache` values it travels
 *  beside: the private symbol means only {@link sshKeepalive} can produce one,
 *  so no bare object literal can reach one of the nine seams that accept a
 *  policy, and there is exactly ONE construction site and ONE error message.
 *
 *  But a brand is a COMPILE-time fact, and it is NOT a runtime guarantee — do
 *  not delete {@link renderableKeepalive} on the theory that it is. Object
 *  spread COPIES the symbol while replacing the numbers, so
 *
 *      const forged: SshKeepalive = { ...sshKeepalive(10, 3), intervalS: 0 };
 *
 *  typechecks with no cast, no `any`, and no access to the private symbol — and
 *  renders `ServerAliveInterval=0`, which turns ssh's dead-peer detection OFF
 *  entirely: the exact eternal hang on a half-open socket this whole option
 *  exists to bound. Freezing the constructor's result does not help; the spread
 *  copies out of the frozen object into a fresh one.
 *
 *  Nor is a runtime ASSERTION on this object enough, and that is the whole
 *  reason {@link KeepalivePlan} exists. `intervalS` and `countMax` are declared
 *  `readonly number`, but a spread can also install an ACCESSOR of that exact
 *  type:
 *
 *      let reads = 0;
 *      const changing: SshKeepalive = {
 *        ...sshKeepalive(10, 3),
 *        get intervalS() { return ++reads <= 2 ? 10 : 0; },
 *      };
 *
 *  Also no cast, also no `any`. A check that VALIDATES the object and then lets
 *  the renderer READ it again is time-of-check/time-of-use: the getter answers
 *  10 while it is inspected and 0 when it is rendered, and the socket tag — a
 *  THIRD read — can disagree with both, so a dial can end up on a `%C-10x3`
 *  master while emitting `ServerAliveInterval=0`. So the brand buys the single
 *  construction site, and {@link renderableKeepalive} — which reads each field
 *  exactly ONCE into an inert snapshot, validates THAT, and hands downstream the
 *  snapshot instead of this object — buys the invariant. */
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
 *  larger: the heartbeat watches a CONNECTED link only (`isLive()` requires
 *  `phase === "connected"`), where it gets no vote anyway, while this bounds the
 *  TRANSPORT's own death in every phase. So a tolerance above the heartbeat's
 *  reachable ceiling is legitimate — it is the ceiling on how long a dead ssh may
 *  go UNNOTICED, not a promise that anything survives that long.
 *  `keepaliveOrdering.test.ts` pins the real ordering, from the constants
 *  themselves. */
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
  assertKeepalivePair({ intervalS, countMax });
  return { intervalS, countMax, [sshKeepaliveBrand]: "ssh-keepalive" };
}

/** THE rule, in one place — the only thing that decides whether a pair of
 *  numbers is a policy at all. Takes the raw pair (not a branded
 *  {@link SshKeepalive}) so {@link sshKeepalive} can run it BEFORE it mints one
 *  and {@link renderableKeepalive} can run it on the snapshot it just captured,
 *  both raising the identical message.
 *
 *  It reads `pair.intervalS` twice (the integer check, then the product) and
 *  that is SAFE only because both callers hand it plain own data properties —
 *  a constructor argument and a captured snapshot. Never call it on a caller's
 *  policy object directly: an accessor would be free to answer differently on
 *  the second read. */
function assertKeepalivePair(pair: {
  readonly intervalS: number;
  readonly countMax: number;
}): void {
  for (const [label, value] of [
    ["intervalS", pair.intervalS],
    ["countMax", pair.countMax],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `ssh keepalive: ${label} must be a positive integer — got ${value}. ` +
          "The value is rejected rather than silently coerced: a non-integer " +
          "renders as an ssh option OpenSSH refuses at connect time.",
      );
    }
  }
  const toleranceS = keepaliveToleranceS(pair);
  if (toleranceS > MAX_SSH_KEEPALIVE_TOLERANCE_S) {
    throw new Error(
      `ssh keepalive: intervalS × countMax must be ≤ ${MAX_SSH_KEEPALIVE_TOLERANCE_S}s — ` +
        `got ${pair.intervalS} × ${pair.countMax} = ${toleranceS}s. ` +
        "A tolerance that long is not dead-peer detection at all; the policy is " +
        "rejected rather than clamped to one the caller never asked for.",
    );
  }
}

/** A policy's numbers, CAPTURED — the inert two-number value that every ssh
 *  option this package emits is actually rendered from.
 *
 *  Distinct from {@link SshKeepalive} on purpose, and separately branded so the
 *  two are not interchangeable in either direction: a `SshKeepalive` is what a
 *  CALLER hands us and may be any object of that shape (see the accessor forgery
 *  at {@link SshKeepalive}), while a `KeepalivePlan` is what
 *  {@link renderableKeepalive} read out of one — plain own data properties,
 *  frozen, validated, and re-readable as many times as the renderers like
 *  without the answer moving. */
export interface KeepalivePlan {
  /** `ServerAliveInterval` — the captured seconds. A positive integer. */
  readonly intervalS: number;
  /** `ServerAliveCountMax` — the captured probe count. A positive integer. */
  readonly countMax: number;
  readonly [keepalivePlanBrand]: "keepalive-plan";
}

/** The ONE boundary between a caller's policy OBJECT and this package's ssh
 *  behaviour: read each field exactly once, validate what was read, and return
 *  it. Throws the same message {@link sshKeepalive} throws.
 *
 *  It returns a VALUE rather than merely asserting, and that is the fix, not a
 *  flourish. An assertion leaves the caller's object as the thing downstream
 *  reads, and there are THREE such reads on a single dial — the integer check,
 *  the `ServerAlive*` render, and {@link policyTag}'s socket name. An accessor
 *  that answers 10, 10, then 0 passes the check, disables dead-peer detection,
 *  and parks the dial on a master named `%C-10x3` for a policy it is not
 *  running. Two reads HERE and none after is what closes that: nothing
 *  downstream may take a `SshKeepalive`, only the plan this returns.
 *
 *  The captured values are stored as-is, never coerced. A field that is somehow
 *  not a whole positive number is REJECTED by the shared rule, exactly as at the
 *  constructor — a coercion here would quietly accept what the constructor
 *  refuses. */
export function renderableKeepalive(keepalive: SshKeepalive): KeepalivePlan {
  const plan = Object.freeze({
    // One read each. Do not re-read `keepalive` below this line.
    intervalS: keepalive.intervalS,
    countMax: keepalive.countMax,
    [keepalivePlanBrand]: "keepalive-plan",
  } as const);
  assertKeepalivePair(plan);
  return plan;
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
 *  happens to key a socket by it. {@link renderableKeepalive} guarantees two
 *  positive integers, so this is always short and free of whitespace and path
 *  separators — an invariant this module both states and enforces, instead of
 *  one module depending on another's promise.
 *
 *  Takes the {@link KeepalivePlan}, never a caller's {@link SshKeepalive}, and
 *  that is load-bearing: the master's name has to be spelled from the SAME two
 *  numbers the `ServerAlive*` options were spelled from, or a dial can ride a
 *  master whose identity claims a policy the dial is not running. */
export function policyTag(plan: KeepalivePlan): string {
  return `${plan.intervalS}x${plan.countMax}`;
}
