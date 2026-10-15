/**
 * Delivering the Agents setting's set to every host — kolu-server's half of
 * the setting, driven on agent-distro's clock, not kolu's. A host's set is two
 * disjoint things, gathered here and landed together:
 *
 *   - agent-distro's PACKAGE (its harnesses): which store path, off upstream's
 *     index for the host's system (`DeliveryOps.published`), pulled by the
 *     host from upstream's cache (`DeliveryOps.pull`) — nothing is built;
 *   - each PROFILE of the setting's stack, in order: locked once per run
 *     (`DeliveryOps.lock`), built with agent-distro's `mkProfile` at the
 *     package's own revision for the host's system (`DeliveryOps.build`,
 *     remembered per revision, tree and system), and shipped into the host's
 *     store, rooted (`DeliveryOps.ship`).
 *
 * The host's padi is told each step (`agentDistro.report`) and records the set
 * that landed. A profile that will not lock, build or ship fails that host's
 * delivery, in words that name it — whatever served there keeps serving.
 *
 * Why a run happens decides one thing ({@link DeliveryTrigger}): a host taking
 * the setting (`connect`: every bind, reconnect and real change) reuses the
 * current schedule period's answers — a reconnect does not re-ask GitHub —
 * while the user's check (`user`) and upstream's schedule (`schedule`) read
 * the index and lock every reference afresh. Within one run each answer is
 * read once.
 *
 * Every run also says whether each profile builds at all (`onResolution`): it
 * is built for this machine's own system first, and that answer is what
 * Settings shows under the profile's entry.
 *
 * The steps are {@link DeliveryOps} (`./ops.ts` in production), so the policy
 * here is testable without a network, Nix or a host.
 */

import { updateDue } from "@juspay/agent-distro/update/due";
import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import type { DeliveredProfile } from "@kolu/agent-distro/landing";
import type {
  AgentDistroDeliveryReport,
  AgentProfileResolution,
} from "@kolu/agent-distro/schema";
import type { Logger } from "@kolu/log";
import type { HostNix, PublishedClosure } from "@kolu/surface-remote";
import type { BuiltProfile, LockedProfile } from "./profiles.ts";

/** The steps of a delivery. Each throws with its own words. */
export interface DeliveryOps {
  /** The Nix system and version of the host `ssh` reaches (`localhost` for
   *  this one) — the system picks the index entry and a profile's build, both
   *  pick the route. */
  hostNixOf(ssh: string): Promise<HostNix>;
  /** The newest published package for `system`, read off upstream's index.
   *  Throws, in words a user reads, when upstream has published none for that
   *  system or the index cannot be read — never a reason to build one. */
  published(system: string): Promise<PublishedClosure>;
  /** Pin one profile reference (`./profiles.ts`' `lockProfile`). */
  lock(reference: string): Promise<LockedProfile>;
  /** Build a locked profile for `hostSystem` with agent-distro at `rev`
   *  (`./profiles.ts`' `buildProfile`). */
  build(args: {
    readonly rev: string;
    readonly locked: LockedProfile;
    readonly hostSystem: string;
  }): Promise<BuiltProfile>;
  /** Get a built profile's closure into the host's store and root it there —
   *  never building on the host. Answers the path it has there. */
  ship(args: {
    readonly ssh: string;
    readonly label: string;
    readonly hostNix: HostNix;
    readonly reference: string;
    readonly path: string;
    readonly onProgress: (line: string) => void;
  }): Promise<
    | { readonly ok: true; readonly path: string }
    | { readonly ok: false; readonly message: string }
  >;
  /** The route: have the host — whose Nix is `hostNix` — pull `published`'s
   *  package in the form it can take and run (`closureRoute`,
   *  `@kolu/surface-remote`), and root it — never building. Answers the path
   *  that landed, or the cause in words a user reads (`label` names the host
   *  in them). */
  pull(args: {
    readonly ssh: string;
    readonly label: string;
    readonly hostNix: HostNix;
    readonly published: PublishedClosure;
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
 *  stack to it was already running). */
export type HostOutcome = "landed" | "failed" | "busy";

export interface AgentDelivery {
  /** Deliver to `keys` (every connected host when omitted), for `trigger`.
   *  Resolves with each host's outcome once every one has ended; never
   *  rejects. A no-op while agents are off. */
  run(opts: {
    readonly keys?: readonly string[];
    readonly trigger: DeliveryTrigger;
  }): Promise<readonly HostOutcome[]>;
  /** Say whether each profile of the setting builds, for this machine
   *  (`onResolution`), reusing this period's answers. Never rejects. */
  resolve(): Promise<void>;
  /** A delivery is in flight. */
  running(): boolean;
}

/** A remembered answer and when it was read, epoch ms. */
interface Known<T> {
  readonly value: T;
  readonly at: number;
}

export function createAgentDelivery(deps: {
  /** Upstream's schedule: a connect reuses an answer within its period. */
  readonly schedule: UpdaterSchedule;
  readonly ops: DeliveryOps;
  readonly log: Logger;
  /** The setting's stack, or `undefined` while agents are off. Read at each
   *  run. */
  readonly stack: () => readonly string[] | undefined;
  /** Every host a delivery can reach now (connected padis). */
  readonly hosts: () => readonly DeliveryHost[];
  /** Each profile of the stack, in order, with whether it builds — published
   *  as the run learns it. */
  readonly onResolution: (
    profiles: readonly {
      readonly reference: string;
      readonly resolution: AgentProfileResolution;
    }[],
  ) => void;
  /** Wall clock, epoch ms. */
  readonly now?: () => number;
}): AgentDelivery {
  const { schedule, ops, log } = deps;
  const now = deps.now ?? Date.now;
  /** The last index answer per system, and the last lock per reference: a
   *  host's connect reuses them within the schedule period. */
  const indexed = new Map<string, Known<PublishedClosure>>();
  const locks = new Map<string, Known<LockedProfile>>();
  /** Every build, by agent-distro revision, tree and system — the same inputs
   *  build the same path, so it is never asked twice. */
  const builds = new Map<string, Promise<BuiltProfile>>();
  /** Deliveries in flight, by `host#stack`: a change of the stack is its own
   *  delivery, never folded into the one still running. */
  const inFlight = new Set<string>();

  /** A remembered answer when `fresh` allows and its period has not turned,
   *  else a new one (remembered on success). */
  const reuse = async <T>(
    memo: Map<string, Known<T>>,
    key: string,
    fresh: boolean,
    read: () => Promise<T>,
  ): Promise<T> => {
    const last = memo.get(key);
    if (
      !fresh &&
      last !== undefined &&
      !updateDue(
        Math.floor(now() / 1000),
        Math.floor(last.at / 1000),
        schedule.periodSeconds,
        schedule.offsetSeconds,
      )
    )
      return last.value;
    const value = await read();
    memo.set(key, { value, at: now() });
    return value;
  };

  const readIndex = (system: string, fresh: boolean) =>
    reuse(indexed, system, fresh, async () => {
      const entry = await ops.published(system);
      log.info(
        { system, rev: entry.rev, ia: entry.ia, ca: entry.ca },
        "agent-distro index read",
      );
      return entry;
    });

  const readLock = (reference: string, fresh: boolean) =>
    reuse(locks, reference, fresh, async () => {
      const locked = await ops.lock(reference);
      log.info(
        { reference, tree: locked.tree, rev: locked.rev },
        "agent-distro profile locked",
      );
      return locked;
    });

  const buildFor = (
    rev: string,
    locked: LockedProfile,
    hostSystem: string,
  ): Promise<BuiltProfile> => {
    const key = JSON.stringify([rev, locked.tree, hostSystem]);
    let build = builds.get(key);
    if (build === undefined) {
      build = ops.build({ rev, locked, hostSystem });
      builds.set(key, build);
      // A failed build is asked again next time: the next fetch may fix it.
      build.catch(() => builds.delete(key));
    }
    return build;
  };

  /** One run's reads, each asked once: the index per system, each lock. */
  const runReads = (fresh: boolean) => {
    const index = new Map<string, Promise<PublishedClosure>>();
    const lock = new Map<string, Promise<LockedProfile>>();
    const once = <T>(
      m: Map<string, Promise<T>>,
      key: string,
      read: () => Promise<T>,
    ): Promise<T> => {
      let p = m.get(key);
      if (p === undefined) {
        p = read();
        m.set(key, p);
      }
      return p;
    };
    return {
      index: (system: string) =>
        once(index, system, () => readIndex(system, fresh)),
      lock: (reference: string) =>
        once(lock, reference, () => readLock(reference, fresh)),
    };
  };

  /** Lock and build `reference` for `hostSystem`, with the package's `rev`. */
  const profileFor = async (
    reads: ReturnType<typeof runReads>,
    reference: string,
    rev: string,
    hostSystem: string,
  ): Promise<{ locked: LockedProfile; built: BuiltProfile }> => {
    const locked = await reads.lock(reference);
    return { locked, built: await buildFor(rev, locked, hostSystem) };
  };

  /** Say, for this machine's system, whether each profile of `stack` builds. */
  const resolveStack = async (
    stack: readonly string[],
    reads: ReturnType<typeof runReads>,
  ): Promise<void> => {
    if (stack.length === 0) {
      deps.onResolution([]);
      return;
    }
    const answers = new Map<string, AgentProfileResolution>(
      stack.map((reference) => [reference, { kind: "pending" }]),
    );
    const publish = () =>
      deps.onResolution(
        stack.map((reference) => ({
          reference,
          resolution: answers.get(reference) ?? { kind: "pending" },
        })),
      );
    publish();
    try {
      const { system } = await ops.hostNixOf("localhost");
      const { rev } = await reads.index(system);
      await Promise.all(
        stack.map(async (reference) => {
          try {
            const { locked, built } = await profileFor(
              reads,
              reference,
              rev,
              system,
            );
            answers.set(reference, {
              kind: "resolved",
              name: built.name,
              description: built.description,
              ...(locked.rev === undefined ? {} : { rev: locked.rev }),
            });
          } catch (err) {
            answers.set(reference, {
              kind: "failed",
              message: err instanceof Error ? err.message : String(err),
            });
          }
          publish();
        }),
      );
    } catch (err) {
      // The index or this machine's Nix did not answer: no profile can be
      // built here, and each says why.
      const message = err instanceof Error ? err.message : String(err);
      for (const reference of stack)
        answers.set(reference, { kind: "failed", message });
      publish();
    }
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
    stack: readonly string[],
    reads: ReturnType<typeof runReads>,
  ): Promise<HostOutcome> => {
    const at = { host: host.label, agentDistroProfiles: stack };
    const onProgress = (line: string) =>
      log.debug({ ...at, line }, "agent-distro delivery");
    const failed = async (message: string): Promise<HostOutcome> => {
      log.warn({ ...at, message }, "agent-distro set not delivered");
      await report(host, { kind: "failed", profiles: stack, message }).catch(
        () => {},
      );
      return "failed";
    };
    try {
      const hostNix = await ops.hostNixOf(host.ssh);
      const published = await reads.index(hostNix.system);
      const delivered: DeliveredProfile[] = [];
      for (const reference of stack) {
        let built: BuiltProfile;
        let locked: LockedProfile;
        try {
          ({ locked, built } = await profileFor(
            reads,
            reference,
            published.rev,
            hostNix.system,
          ));
        } catch (err) {
          return await failed(
            `the ${reference} profile: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const shipped = await ops.ship({
          ssh: host.ssh,
          label: host.label,
          hostNix,
          reference,
          path: built.path,
          onProgress,
        });
        if (!shipped.ok)
          return await failed(`the ${built.name} profile: ${shipped.message}`);
        delivered.push({
          reference,
          name: built.name,
          ...(locked.rev === undefined ? {} : { rev: locked.rev }),
          path: shipped.path,
        });
      }
      const res = await ops.pull({
        ssh: host.ssh,
        label: host.label,
        hostNix,
        published,
        onProgress,
      });
      if (!res.ok) return await failed(res.message);
      await report(host, {
        kind: "landed",
        profiles: stack,
        bundle: res.bundle,
        delivered,
      });
      log.info(
        { ...at, bundle: res.bundle, delivered },
        "agent-distro set delivered",
      );
      return "landed";
    } catch (err) {
      log.warn({ ...at, err }, "agent-distro delivery failed");
      return await failed(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    running: () => inFlight.size > 0,
    resolve: async () => {
      const stack = deps.stack();
      if (stack === undefined) {
        deps.onResolution([]);
        return;
      }
      await resolveStack(stack, runReads(false));
    },
    run: async ({ keys, trigger }) => {
      const stack = deps.stack();
      if (stack === undefined) return [];
      const slotOf = (h: DeliveryHost) => `${h.key}#${JSON.stringify(stack)}`;
      const targets = deps
        .hosts()
        .filter((h) => keys === undefined || keys.includes(h.key));
      const ours: DeliveryHost[] = [];
      const outcomes: HostOutcome[] = [];
      for (const host of targets) {
        if (inFlight.has(slotOf(host))) outcomes.push("busy");
        else {
          inFlight.add(slotOf(host));
          ours.push(host);
        }
      }
      const reads = runReads(trigger !== "connect");
      // Settings learns whether each profile builds, whether or not a host is
      // reachable this run.
      const resolved = resolveStack(stack, reads);
      if (ours.length === 0) {
        await resolved;
        return outcomes;
      }
      try {
        const started = await Promise.all(
          ours.map((h) =>
            report(h, { kind: "delivering", profiles: stack }).then(
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
        outcomes.push(
          ...(await Promise.all(live.map((h) => deliverOne(h, stack, reads)))),
        );
        await resolved;
        return outcomes;
      } finally {
        for (const h of ours) inFlight.delete(slotOf(h));
      }
    },
  };
}
