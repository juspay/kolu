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
} from "@kolu/port-forward";
import type { Logger } from "@kolu/log";
import type { PortFamily } from "@kolu/port-scan/ports";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type {
  ForwardCreateInput,
  ForwardOrigin,
  Forwards,
  KoluForward,
} from "kolu-common/surface";

/** How often the auto-cancel pass runs.
 *
 *  The port scanner's own baseline is 5 s, so a shorter interval here would only
 *  re-read the same sample and a much longer one would leave a door open over a
 *  server that is visibly gone. The Atlas note's acceptance bar — "stopping the
 *  server auto-cancels within two scan ticks" — is exactly this number matched to
 *  that one. */
export const FORWARD_REAP_INTERVAL_MS = 5_000;

/** What a host's listening ports look like to this module — each port mapped to
 *  the IP family it is bound on.
 *
 *  `"unknown"` is not "none" and the distinction is the whole of the auto-cancel
 *  rule: it means no terminal on that host has ever been scanned successfully, or
 *  every scan we have is blind. A map — even an empty one — is an OBSERVATION,
 *  and only an observation may close a door.
 *
 *  It carries the FAMILY and not just the port numbers because the same reading
 *  answers both of this module's questions: which doors to close, and — for a
 *  door about to be opened — which loopback to dial. Deriving the family here
 *  rather than accepting it from the client is deliberate: the client's copy can
 *  be a scan or two stale, and a stale family opens a door onto an address with
 *  nothing behind it. */
export type HostPorts = ReadonlyMap<number, PortFamily> | "unknown";

export interface KoluForwards {
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

export function createKoluForwards(deps: {
  /** The host's listening ports, as the port scanner sees them. Injected rather
   *  than read here: this module's rules are about what to DO with the answer,
   *  and wiring them to a padi mirror would make every one of them need one. */
  readHostPorts: (host: HostKey) => Promise<HostPorts>;
  /** Called whenever the list changes, with the new list. The surface cell's
   *  push source. */
  onChange: (forwards: Forwards) => void;
  log: Logger;
  /** The forward map. Defaults to the real one; injected by tests. */
  makeManager?: (opts: {
    onLost: (loss: ForwardLoss) => void;
  }) => ForwardManager;
}): KoluForwards {
  /** Why each live forward exists, by key. The library's map holds the door; this
   *  holds the reason, which is the only thing kolu adds to it.
   *
   *  Entries are dropped when the key leaves the library's map, so this cannot
   *  outgrow it — and `list()` reads the library's map as the truth and looks the
   *  origin up, never the other way round, so a key that somehow lost its origin
   *  produces a row with a defaulted one rather than a vanished forward. */
  const origins = new Map<string, ForwardOrigin>();

  const manager = (deps.makeManager ?? createForwardManager)({
    onLost: ({ forward, reason, kind }) => {
      // `gone` has left the map; `degraded` is still in it and may still be
      // reachable, so its origin must stay. Saying "lost" about a row the user
      // can still see would be the list contradicting itself.
      if (kind === "gone") origins.delete(forward.key);
      deps.log.warn(
        { key: forward.key, reason, kind },
        "port forward reported by its mechanism",
      );
      publish();
    },
  });

  /** The wire row for one library forward. `origin` defaults to `manual` for a
   *  key with no recorded reason, and that direction is deliberate: the two ways
   *  to be wrong are "close a door the user asked for" and "leave a convenience
   *  door open", and only the first loses work. */
  const rowOf = (forward: Forward): KoluForward => ({
    key: forward.key,
    host: hostOf(forward.target),
    remotePort: forward.target.port,
    localPort: forward.localPort,
    origin: origins.get(forward.key) ?? "manual",
    createdAt: forward.createdAt,
  });

  const list = (): Forwards => manager.list().map(rowOf);

  /** Tell the cell. Every path that can move the map ends here — never with an
   *  edit to a mirrored copy, which would be a second definition of what the
   *  map's own membership means. */
  const publish = (): void => {
    deps.onChange(list());
  };

  return {
    async create(input) {
      // WHICH loopback to dial comes from kolu's own scan of that host, never
      // from the caller: a client's copy of the port facts can be a scan or two
      // stale, and a stale family opens a door onto an address with nothing
      // behind it — which is exactly the shape of the bug this reading closes.
      // A port the scan cannot speak for falls to `ASSUMED_LOOPBACK`.
      const seen = await deps
        .readHostPorts(input.host)
        .catch((err: unknown) => {
          deps.log.error(
            { err, host: encodeHostKey(input.host) },
            "could not read a host's ports while opening a forward — dialling the assumed loopback",
          );
          return "unknown" as const;
        });
      const loopback =
        seen === "unknown"
          ? ASSUMED_LOOPBACK
          : (seen.get(input.port) ?? ASSUMED_LOOPBACK);
      const target = targetFor(input.host, input.port, loopback);
      const forward = await manager.create(target);
      // Idempotent by target, so this may be a forward that already existed. A
      // `manual` request over an `auto` forward PROMOTES it: the user has now
      // asked for this target by name, and a door someone deliberately set up
      // must not be closed by a scanner. The reverse never happens — a chip
      // click cannot demote a manual forward into one kolu may reap.
      const existing = origins.get(forward.key);
      if (existing === undefined || input.origin === "manual") {
        origins.set(forward.key, input.origin);
      }
      publish();
      return rowOf(forward);
    },

    async cancel(key) {
      await manager.cancel(key);
      origins.delete(key);
      publish();
    },

    list,

    async reconcile() {
      // Which hosts to ask is decided by the forwards themselves, so a kolu with
      // no auto forwards reads nothing at all — the cost tracks the feature's
      // use rather than the size of the fleet.
      const auto = manager.list().filter((f) => origins.get(f.key) === "auto");
      if (auto.length === 0) return list();

      const hosts = new Map<string, HostKey>();
      for (const f of auto)
        hosts.set(encodeHostKey(hostOf(f.target)), hostOf(f.target));

      const ports = new Map<string, HostPorts>();
      for (const [enc, host] of hosts) {
        try {
          ports.set(enc, await deps.readHostPorts(host));
        } catch (err) {
          // A read that FAILED is not evidence that anything died. Log it (a
          // failed read is an anomaly, not a degraded-but-fine state) and leave
          // this host's doors standing.
          deps.log.error(
            { err, host: enc },
            "could not read a host's ports for forward auto-cancel — its forwards are left standing",
          );
          ports.set(enc, "unknown");
        }
      }

      for (const forward of auto) {
        // Re-read the origin HERE rather than trusting the snapshot above. The
        // host reads between them are network-shaped — a surface mirror, bounded
        // at seconds — and a ⌘K "Forward a port…" for this same target lands in
        // that window as a promotion to `manual`, which is the user saying "keep
        // this until I say otherwise". Acting on a decision taken before they
        // spoke would close a door they had just pinned.
        if (origins.get(forward.key) !== "auto") continue;
        const host = hostOf(forward.target);
        const seen = ports.get(encodeHostKey(host));
        // `unknown` — including the failed read above — is not a death. Only a
        // real observation that does NOT contain this port closes the door.
        if (seen === undefined || seen === "unknown") continue;
        if (seen.has(forward.target.port)) continue;
        deps.log.info(
          { key: forward.key, port: forward.target.port },
          "auto forward's listener is gone — cancelling it",
        );
        try {
          await manager.cancel(forward.key);
          origins.delete(forward.key);
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
      const doomed = manager
        .list()
        .filter((f) => encodeHostKey(hostOf(f.target)) === enc);
      for (const forward of doomed) {
        try {
          await manager.cancel(forward.key);
          origins.delete(forward.key);
        } catch (err) {
          deps.log.error(
            { err, key: forward.key, host: enc },
            "could not cancel a departed host's forward — it is still listed",
          );
        }
      }
      if (doomed.length > 0) publish();
    },

    async dispose() {
      origins.clear();
      try {
        await manager.dispose();
      } finally {
        publish();
      }
    },
  };
}
