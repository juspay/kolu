/**
 * kolu's port forwards — the POLICY over `@kolu/port-forward`'s map.
 *
 * The library answers "open a door to `(host, port)` and keep it exactly as long
 * as this process lives". Everything kolu adds on top is here, and it is all
 * policy the library must not have an opinion about:
 *
 *  - **`auto` vs `manual`.** Why a forward exists decides whether it may be
 *    closed without being asked. A chip click is `auto` — a convenience over a
 *    listener the scanner watches, so it goes when that listener goes. A typed
 *    target is `manual` and only an explicit cancel (or its host leaving) closes
 *    it, because it may point at something no scanner can see.
 *  - **Auto-cancel on positive evidence only.** A door closes when the scanner
 *    reports the listener behind it gone — never when the scanner simply could
 *    not look. Those are different facts, and `TerminalPorts`' `known`/`unknown`
 *    two-way exists precisely so this code can tell them apart; treating a blind
 *    pass as "the port died" would tear down a working forward every time a host
 *    hiccuped.
 *  - **The kolu host key ↔ ssh destination mapping**, which is one line because
 *    `HostKey` and `ForwardTarget` are the same two-case shape: kolu's local host
 *    is the library's `local` relay target, and a remote host's ssh destination
 *    IS the library's `remote` host.
 *
 * It owns no timers and reads nothing itself. The cadence and the port reading
 * are injected, so every rule above is testable without a socket, an ssh child
 * or a padi.
 */

import {
  ASSUMED_LOOPBACK,
  createForwardManager,
  type Forward,
  type ForwardLoss,
  type ForwardManager,
  type ForwardTarget,
  type LoopbackFamily,
  targetKey,
} from "@kolu/port-forward";
import { match } from "ts-pattern";
import type { HostPorts } from "./hostPorts.ts";
import type { Logger } from "@kolu/log";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type {
  ForwardCreateInput,
  ForwardOrigin,
  Forwards,
  KoluForward,
  PortFamily,
} from "kolu-common/surface";

/** How often the auto-cancel pass runs.
 *
 *  The port scanner's own baseline is 5 s, so a shorter interval here would only
 *  re-read the same sample and a much longer one would leave a door open over a
 *  server that is visibly gone. The Atlas note's acceptance bar — "stopping the
 *  server auto-cancels within two scan ticks" — is exactly this number matched to
 *  that one. */
export const FORWARD_REAP_INTERVAL_MS = 5_000;

/** The REAPER's budget for reading one host. Generous on purpose: it is a
 *  wedge-breaker, not a latency budget, and tripping it costs one sample of a
 *  background pass that runs every 5 s. */
export const REAP_READ_DEADLINE_MS = 10_000;

/** The CLICK path's budget for the same read, and a different number because it
 *  is a different volatility of it: a user is watching, with the Inspector's
 *  button disabled and a blank tab already open beside it. A read that trips
 *  this has a correct answer waiting — `unknown` → the assumed family — so a
 *  tight budget degrades to the documented assumption instead of to a wait. */
export const CREATE_READ_DEADLINE_MS = 1_000;

export interface KoluForwards {
  /** Subscribe to the map's change EDGE — someone opened or cancelled a door, a
   *  mechanism reported one lost. A bare notification and deliberately
   *  payload-free: the list is read back through {@link KoluForwards.reconcile},
   *  which is the only path a value reaches the wire by, and a payload here
   *  would be a second one — the exact shape (announce on the edge that triggers
   *  the read) that froze production. Returns an unsubscribe. */
  subscribe(tick: () => void): () => void;
  /** Open a forward, or return the live one for the same target. A `manual`
   *  request over a live `auto` forward PROMOTES it (see `create`). */
  create(input: ForwardCreateInput): Promise<KoluForward>;
  /** Take one down by key. Rejects on an unknown key. */
  cancel(key: string): Promise<void>;
  /** Every live forward, oldest first — a plain read, no reconciliation. */
  list(): Forwards;
  /** Reconcile, then report: close every `auto` forward whose remote port the
   *  scanner can positively say is gone, and return the resulting list.
   *
   *  ONE method rather than a reap plus a read, and that is a fix rather than a
   *  convenience. When they were two, the reap announced its own changes on the
   *  cell's change edge — and the cell's change edge is what triggers the read
   *  the reap runs inside. So a single live `auto` forward made the server spin:
   *  read → reap → announce → tick → read → … with the event loop never
   *  yielding to anything else. It froze production on the first forward click
   *  (HTTP dead, SIGTERM ignored) and was invisible until then, because with zero
   *  auto forwards the reap returned before it announced.
   *
   *  Collapsing them removes the cycle at the source instead of damping it: this
   *  reports by RETURNING, the poll publishes what it returns, and there is no
   *  spelling of "reap and announce" left for a later caller to reach for. Never
   *  throws — a host that cannot be read keeps its forwards. */
  reconcile(): Promise<Forwards>;
  /** A host left the pool — take ITS forwards down, both origins. A door to a
   *  machine kolu no longer has is a door to nowhere. */
  hostDeparted(host: HostKey): Promise<void>;
  /** Close everything. */
  dispose(): Promise<void>;
}

/** WHEN kolu reaches for the library's {@link ASSUMED_LOOPBACK}: a port it has NO
 *  scan row for — a manual forward to something outside every terminal's subtree,
 *  or a host whose scan is blind. WHICH family that assumption names is the
 *  library's to say and is imported rather than restated, so the decision has one
 *  home; the fix for not knowing is to know, which is what the scan reading below
 *  is for. */

/** The library target for a kolu host + port. The two vocabularies are the same
 *  two cases, which is not a coincidence: a port on the machine kolu-server runs
 *  on needs a relay (both ends are here), and a port anywhere else needs the ssh
 *  hop whose destination kolu already holds as the host key's target. */
export function targetFor(
  host: HostKey,
  port: number,
  loopback: LoopbackFamily,
): ForwardTarget {
  return host.kind === "local"
    ? { kind: "local", port, loopback }
    : { kind: "remote", host: host.target, port, loopback };
}

/** …and back, so a row can be filtered to a terminal's host. Total, because the
 *  only targets in this map are ones {@link targetFor} produced. */
function hostOf(target: ForwardTarget): HostKey {
  return target.kind === "local"
    ? { kind: "local" }
    : { kind: "remote", target: target.host };
}

/** The library's loopback family for a SCANNED one.
 *
 *  The two packages declare the same two-way separately — `@kolu/port-forward`
 *  takes no zod dependency, so it cannot share `PortFamilySchema` — and this is
 *  the ONE place they are joined. Exhaustive on purpose: the unions are
 *  identical today, which is exactly why a structural assignment would be the
 *  seam that does NOT break when one of them grows an arm (`"v4-mapped"` on the
 *  scanner side is the obvious candidate; `mappedV4` already exists in
 *  `scan.ts`). Here that is a compile error instead. */
function loopbackOf(family: PortFamily): LoopbackFamily {
  return match(family)
    .with("v4", () => "v4" as const)
    .with("v6", () => "v6" as const)
    .exhaustive();
}

export function createKoluForwards(deps: {
  /** The host's listening ports, as the port scanner sees them, bounded by the
   *  CALLER's deadline. Injected rather than read here: this module's rules are
   *  about what to DO with the answer, and wiring them to a padi mirror would
   *  make every one of them need one.
   *
   *  The budget is the caller's because the two callers have irreconcilable
   *  ones — see {@link REAP_READ_DEADLINE_MS} and
   *  {@link CREATE_READ_DEADLINE_MS}. */
  readHostPorts: (host: HostKey, deadlineMs: number) => Promise<HostPorts>;
  /** Is this host still in kolu's pool? Consulted on the way into a create,
   *  because a door is only ever worth opening to a machine kolu still has. */
  hostIsMember: (host: HostKey) => boolean;
  log: Logger;
  /** The forward map. Defaults to the real one; injected by tests. */
  makeManager?: (opts: {
    onLost: (loss: ForwardLoss<ForwardOrigin>) => void;
  }) => ForwardManager<ForwardOrigin>;
}): KoluForwards {
  const manager = (deps.makeManager ?? createForwardManager<ForwardOrigin>)({
    onLost: ({ forward, reason, kind }) => {
      deps.log.warn(
        { key: forward.key, reason, kind },
        "port forward reported by its mechanism",
      );
      notify();
    },
  });

  /** Every subscriber to the change EDGE. The multiplicity lives here rather
   *  than in the boot file that used to hold a `Set` beside this module: how
   *  many listeners there are is a property of the thing being listened to. */
  const listeners = new Set<() => void>();

  /** The wire row for one library forward. The origin comes off the forward's
   *  own `meta`, so there is no second map to keep in step and no defaulting
   *  read to survive them disagreeing. */
  const rowOf = (forward: Forward<ForwardOrigin>): KoluForward => ({
    key: forward.key,
    host: hostOf(forward.target),
    remotePort: forward.target.port,
    localPort: forward.localPort,
    origin: forward.meta,
    createdAt: forward.createdAt,
  });

  const list = (): Forwards => manager.list().map(rowOf);

  /** Tell every subscriber that the map MOVED, and nothing more. Deliberately
   *  payload-free: the list is read back through `reconcile()`, which is the
   *  only path a value reaches the wire by — see `reconcile` on the interface
   *  for the freeze that shape prevents. */
  const notify = (): void => {
    for (const tick of listeners) tick();
  };

  /** Is there already a door onto this target? Asked by key, which is the map's
   *  own identity for it, so this cannot drift from what `create` will decide. */
  const alreadyOpen = (input: ForwardCreateInput): boolean => {
    const key = targetKey(targetFor(input.host, input.port, ASSUMED_LOOPBACK));
    return manager.list().some((f) => f.key === key);
  };

  /** The loopback family to dial for a port about to be opened. A read that
   *  times out on this path has a correct answer already — the assumption — so
   *  the tight budget degrades to the documented guess rather than to a wait. */
  const familyFor = async (
    input: ForwardCreateInput,
  ): Promise<LoopbackFamily> => {
    const seen = await deps
      .readHostPorts(input.host, CREATE_READ_DEADLINE_MS)
      .catch((err: unknown) => {
        deps.log.error(
          { err, host: encodeHostKey(input.host) },
          "could not read a host's ports while opening a forward — dialling the assumed loopback",
        );
        return { status: "unknown" } as const;
      });
    if (seen.status !== "known") return ASSUMED_LOOPBACK;
    const family = seen.ports.get(input.port);
    return family === undefined ? ASSUMED_LOOPBACK : loopbackOf(family);
  };

  return {
    subscribe(tick) {
      listeners.add(tick);
      return () => listeners.delete(tick);
    },

    async create(input) {
      // WHICH loopback to dial comes from kolu's own scan of that host, never
      // from the caller: a client's copy of the port facts can be a scan or two
      // stale, and a stale family opens a door onto an address with nothing
      // behind it — which is exactly the shape of the bug this reading closes.
      // A port the scan cannot speak for falls to `ASSUMED_LOOPBACK`.
      //
      // Skipped entirely when the target is already open: the map is idempotent
      // by target and KEEPS the family the live door was opened with, so the
      // read could not change the outcome — and this is the click path, with a
      // blank tab already open beside it.
      const target = alreadyOpen(input)
        ? targetFor(input.host, input.port, ASSUMED_LOOPBACK)
        : targetFor(input.host, input.port, await familyFor(input));
      // Re-check membership HERE, after the scan read, not only on the way in.
      // The read is a network-shaped await, and a host can leave the pool during
      // it — `hostDeparted` then walks a map that does not yet hold this target
      // and misses it, and the flight lands as a live listener for a machine
      // kolu no longer has: unauthenticated on every interface of the kolu
      // server, with no host tab left to cancel it from.
      if (!deps.hostIsMember(input.host)) {
        throw new Error(
          `kolu no longer has the host "${encodeHostKey(input.host)}" — not opening a forward to it.`,
        );
      }
      const forward = await manager.create(target, input.origin);
      // Idempotent by target, so this may be a forward that already existed. A
      // `manual` request over an `auto` forward PROMOTES it: the user has now
      // asked for this target by name, and a door someone deliberately set up
      // must not be closed by a scanner. The reverse never happens — a chip
      // click cannot demote a manual forward into one kolu may reap.
      const row = rowOf(
        input.origin === "manual" && forward.meta !== "manual"
          ? manager.promote(forward.key, "manual")
          : forward,
      );
      notify();
      return row;
    },

    async cancel(key) {
      await manager.cancel(key);
      notify();
    },

    list,

    async reconcile() {
      // Which hosts to ask is decided by the forwards themselves, so a kolu with
      // no auto forwards reads nothing at all — the cost tracks the feature's
      // use rather than the size of the fleet.
      const auto = manager.list().filter((f) => f.meta === "auto");
      if (auto.length === 0) return list();

      const hosts = new Map<string, HostKey>();
      for (const f of auto)
        hosts.set(encodeHostKey(hostOf(f.target)), hostOf(f.target));

      const ports = new Map<string, HostPorts>();
      for (const [enc, host] of hosts) {
        try {
          ports.set(enc, await deps.readHostPorts(host, REAP_READ_DEADLINE_MS));
        } catch (err) {
          // A read that FAILED is not evidence that anything died. Log it (a
          // failed read is an anomaly, not a degraded-but-fine state) and leave
          // this host's doors standing.
          deps.log.error(
            { err, host: enc },
            "could not read a host's ports for forward auto-cancel — its forwards are left standing",
          );
          ports.set(enc, { status: "unknown" });
        }
      }

      for (const forward of auto) {
        // Re-read the origin HERE rather than trusting the snapshot above. The
        // host reads between them are network-shaped — a surface mirror, bounded
        // at seconds — and a ⌘K "Forward a port…" for this same target lands in
        // that window as a promotion to `manual`, which is the user saying "keep
        // this until I say otherwise". Acting on a decision taken before they
        // spoke would close a door they had just pinned. The live entry IS the
        // origin now, so this is a read of the map rather than of a table
        // remembered beside it.
        if (
          manager.list().find((f) => f.key === forward.key)?.meta !== "auto"
        ) {
          continue;
        }
        const host = hostOf(forward.target);
        const seen = ports.get(encodeHostKey(host));
        // `unknown` — including the failed read above — is not a death. Only a
        // real observation that does NOT contain this port closes the door. One
        // spelling, because the tag carries the whole question: a missing entry
        // is unreachable anyway (the map is built from the same host set it is
        // read with), and defensive code for an unrepresentable state was the
        // tell that the representation was not carrying the rule.
        if (seen?.status !== "known") continue;
        if (seen.ports.has(forward.target.port)) continue;
        deps.log.info(
          { key: forward.key, port: forward.target.port },
          "auto forward's listener is gone — cancelling it",
        );
        try {
          await manager.cancel(forward.key);
        } catch (err) {
          // The door would not close. It stays in the map (the library keeps a
          // listener it could not shut) and stays visible, so the user can retry
          // — which is exactly why this pass must not swallow the failure.
          deps.log.error(
            { err, key: forward.key },
            "could not cancel a dead auto forward — it is still listed",
          );
        }
      }
      // Reported by RETURNING, never by announcing. Announcing here is what
      // triggered the read this runs inside — see `reconcile` on the interface.
      return list();
    },

    async hostDeparted(host) {
      const enc = encodeHostKey(host);
      // Every target the map HOLDS, not every forward it lists: a door still
      // opening has no record to list yet, and a create in flight when its host
      // leaves would otherwise land as a live listener for a machine kolu no
      // longer has — with no host tab left to cancel it from. `cancel` handles
      // an opening slot by recording the intent and tearing the flight down on
      // arrival; enumerating it is what was missing.
      const doomed = manager
        .targets()
        .filter((t) => encodeHostKey(hostOf(t)) === enc)
        .map((t) => ({ key: targetKey(t) }));
      for (const forward of doomed) {
        try {
          await manager.cancel(forward.key);
        } catch (err) {
          deps.log.error(
            { err, key: forward.key, host: enc },
            "could not cancel a departed host's forward — it is still listed",
          );
        }
      }
      if (doomed.length > 0) notify();
    },

    async dispose() {
      try {
        await manager.dispose();
      } finally {
        // No side table to clear: a listener that SURVIVED teardown is still in
        // the map and still carries its own origin, so the list that follows is
        // the truth about it rather than a defaulted guess.
        notify();
      }
    },
  };
}
