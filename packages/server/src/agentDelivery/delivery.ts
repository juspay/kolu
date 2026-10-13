/**
 * Delivering agent-distro's bundles to every host — kolu-server's half of the
 * Agents setting, driven on agent-distro's clock, not kolu's: per run, for
 * each bound host's system, which bundle (`DeliveryOps.published`), then
 * getting it onto the host (`DeliveryOps.pull`) — nothing is ever built. The
 * host's padi is told each step (`agentDistro.report`) and points `current`
 * at what landed.
 *
 * Why a run happens decides one thing ({@link DeliveryTrigger}): a host taking
 * the setting (`connect`: every bind, reconnect and real change) reuses the
 * current schedule period's index answer — a reconnect does not re-ask GitHub
 * — while the user's check (`user`) and upstream's schedule (`schedule`) read
 * the index afresh. Within one run each system's answer is read once.
 *
 * The steps are {@link DeliveryOps} (`./ops.ts` in production), so the policy
 * here is testable without a network or a host.
 */

import type { CaIndexEntry } from "@kolu/agent-distro/caIndex";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import { type UpdaterSchedule, updateDue } from "@kolu/agent-distro/schedule";
import type { Logger } from "@kolu/log";
import type { HostNix } from "@kolu/surface-remote";

/** The steps of a delivery. Each throws with its own words. */
export interface DeliveryOps {
  /** The Nix system and version of the host `ssh` reaches (`localhost` for
   *  this one) — the system picks the index entry, both pick the route. */
  hostNixOf(ssh: string): Promise<HostNix>;
  /** `profile`'s newest published bundle for `system`, read off upstream's
   *  index. Throws, in words a user reads, when upstream has published none
   *  for that system or the index cannot be read — never a reason to
   *  evaluate or build one. */
  published(system: string, profile: string): Promise<CaIndexEntry>;
  /** The route: have the host — whose Nix is `hostNix` — pull `published`'s
   *  bundle in the form it can take and run (`./route.ts`), and root it —
   *  never building. Answers the path that landed, or the cause in words a
   *  user reads (`label` names the host in them). */
  pull(args: {
    readonly ssh: string;
    readonly label: string;
    readonly hostNix: HostNix;
    readonly published: CaIndexEntry;
    readonly profile: string;
    readonly onProgress: (line: string) => void;
  }): Promise<
    | { readonly ok: true; readonly bundle: string }
    | { readonly ok: false; readonly message: string }
  >;
}

/** A host a delivery can reach: its pool key, how the route reaches it, how
 *  messages name it, and its padi's `agentDistro.report`. */
export interface DeliveryHost {
  readonly key: string;
  /** `localhost` for this machine, else the ssh destination. */
  readonly ssh: string;
  readonly label: string;
  report(report: AgentDistroDeliveryReport): Promise<void>;
}

/** Why a run happens — see the module header. */
export type DeliveryTrigger = "connect" | "user" | "schedule";

/** How one host's delivery ended: `landed`; `failed` (retried on upstream's
 *  schedule, a reconnect, or the user's check); or `busy` (a delivery of that
 *  bundle to it was already running). */
export type HostOutcome = "landed" | "failed" | "busy";

export interface AgentDelivery {
  /** Deliver to `keys` (every connected host when omitted), for `trigger`.
   *  Resolves with each host's outcome once every one has ended; never
   *  rejects. A no-op while agents are off. */
  run(opts: {
    readonly keys?: readonly string[];
    readonly trigger: DeliveryTrigger;
  }): Promise<readonly HostOutcome[]>;
  /** A delivery is in flight. */
  running(): boolean;
}

export function createAgentDelivery(deps: {
  /** Upstream's schedule: a connect reuses an index answer within its period. */
  readonly schedule: UpdaterSchedule;
  readonly ops: DeliveryOps;
  readonly log: Logger;
  /** The bundle the current setting rides (`bundleProfileOf`), or `undefined`
   *  while agents are off. Read at each run. */
  readonly bundle: () => string | undefined;
  /** Every host a delivery can reach now (connected padis). */
  readonly hosts: () => readonly DeliveryHost[];
  /** Wall clock, epoch ms. */
  readonly now?: () => number;
}): AgentDelivery {
  const { schedule, ops, log } = deps;
  const now = deps.now ?? Date.now;
  /** The last index answer per `system#profile`, and when it was read: a
   *  host's connect reuses it within the schedule period. */
  const known = new Map<
    string,
    { readonly entry: CaIndexEntry; readonly at: number }
  >();
  /** Deliveries in flight, by `host#bundle`: a switch to ANOTHER profile is
   *  its own delivery, never folded into the one still running. */
  const inFlight = new Set<string>();

  /** `profile`'s bundle for `system`: the period's known answer when allowed,
   *  else a fresh read of the index (remembered on success). */
  const readIndex = async (
    system: string,
    profile: string,
    fresh: boolean,
  ): Promise<CaIndexEntry> => {
    const key = `${system}#${profile}`;
    const last = known.get(key);
    if (
      !fresh &&
      last !== undefined &&
      !updateDue(Math.floor(now() / 1000), Math.floor(last.at / 1000), schedule)
    )
      return last.entry;
    const entry = await ops.published(system, profile);
    known.set(key, { entry, at: now() });
    log.info(
      {
        system,
        agentDistroProfile: profile,
        rev: entry.rev,
        ia: entry.ia,
        ca: entry.ca,
      },
      "agent-distro index read",
    );
    return entry;
  };

  const report = async (
    host: DeliveryHost,
    r: AgentDistroDeliveryReport,
  ): Promise<void> => {
    try {
      await host.report(r);
    } catch (err) {
      // The host's padi did not take the report (it dropped, or refused a
      // landing it cannot hold): logged at error, and the outcome below is the
      // delivery's own.
      log.error(
        { err, host: host.label, report: r.kind },
        "agent-distro delivery report to padi failed",
      );
      throw err;
    }
  };

  const deliverOne = async (
    host: DeliveryHost,
    profile: string,
    /** One index read per system per run, shared by its hosts. */
    bundleFor: (system: string) => Promise<CaIndexEntry>,
  ): Promise<HostOutcome> => {
    const at = { host: host.label, agentDistroProfile: profile };
    try {
      const hostNix = await ops.hostNixOf(host.ssh);
      const published = await bundleFor(hostNix.system);
      const res = await ops.pull({
        ssh: host.ssh,
        label: host.label,
        hostNix,
        published,
        profile,
        onProgress: (line) =>
          log.debug({ ...at, line }, "agent-distro delivery"),
      });
      if (res.ok) {
        await report(host, { kind: "landed", profile, bundle: res.bundle });
        log.info(
          { ...at, bundle: res.bundle },
          "agent-distro bundle delivered",
        );
        return "landed";
      }
      const { message } = res;
      log.warn({ ...at, message }, "agent-distro bundle not delivered");
      await report(host, { kind: "failed", profile, message });
      return "failed";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ ...at, err }, "agent-distro delivery failed");
      await report(host, { kind: "failed", profile, message }).catch(() => {});
      return "failed";
    }
  };

  return {
    running: () => inFlight.size > 0,
    run: async ({ keys, trigger }) => {
      const profile = deps.bundle();
      if (profile === undefined) return [];
      const targets = deps
        .hosts()
        .filter((h) => keys === undefined || keys.includes(h.key));
      const ours: DeliveryHost[] = [];
      const outcomes: HostOutcome[] = [];
      for (const host of targets) {
        const slot = `${host.key}#${profile}`;
        if (inFlight.has(slot)) outcomes.push("busy");
        else {
          inFlight.add(slot);
          ours.push(host);
        }
      }
      if (ours.length === 0) return outcomes;
      try {
        const started = await Promise.all(
          ours.map((h) =>
            report(h, { kind: "delivering", profile }).then(
              () => h,
              () => undefined,
            ),
          ),
        );
        // A host whose padi did not take even the start report is not
        // reachable for this run: its next connect delivers.
        const live = started.filter((h): h is DeliveryHost => h !== undefined);
        outcomes.push(
          ...ours.filter((h) => !live.includes(h)).map(() => "failed" as const),
        );
        if (live.length === 0) return outcomes;
        const fresh = trigger !== "connect";
        const reads = new Map<string, Promise<CaIndexEntry>>();
        const bundleFor = (system: string) => {
          let entry = reads.get(system);
          if (entry === undefined) {
            entry = readIndex(system, profile, fresh);
            reads.set(system, entry);
          }
          return entry;
        };
        outcomes.push(
          ...(await Promise.all(
            live.map((h) => deliverOne(h, profile, bundleFor)),
          )),
        );
        return outcomes;
      } finally {
        for (const h of ours) inFlight.delete(`${h.key}#${profile}`);
      }
    },
  };
}
