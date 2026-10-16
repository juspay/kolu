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
 *     package's own revision for the host's system (`DeliveryOps.build`), and shipped into the host's
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
 * the index, lock every reference and build every profile afresh (so an
 * edited path profile is picked up). Within one run each answer is
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
import {
  type DeliveredProfile,
  referencesOf,
  sameStack,
} from "@kolu/agent-distro/landing";
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
 *  schedule, a reconnect, or the user's check); `busy` (a delivery of that
 *  stack to it was already running); or `superseded` (the setting moved to
 *  another stack while it ran — the newer stack's own run delivers that, and
 *  padi would refuse this one's landing, so nothing is reported and nothing
 *  failed). */
export type HostOutcome = "landed" | "failed" | "busy" | "superseded";

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
/** How a run reads: `since` — the ask count when a fresh run started, which
 *  takes only answers asked after — or absent for a connect, which reuses the
 *  period's. */
interface Run {
  readonly since?: number;
}

/** A remembered answer: when it was asked (wall clock, for the period), its
 *  place in the order of asks (for a fresh run), and whether it failed. */
interface Known<T> {
  readonly value: T;
  readonly at: number;
  readonly ask: number;
  failed: boolean;
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
  const indexed = new Map<string, Known<Promise<PublishedClosure>>>();
  const locks = new Map<string, Known<Promise<LockedProfile>>>();
  /** The last build per agent-distro revision, tree and system — reused like
   *  the index and the locks, never longer: a path's tree is the user's own
   *  directory, which changes under the same key, and a profile's plugins
   *  named by a flake reference are locked only when it builds. */
  const builds = new Map<string, Known<Promise<BuiltProfile>>>();
  /** Each reference's last answer, shown while it is asked again — a re-check
   *  of a profile that built does not flash back to `pending`; only a
   *  reference never answered is. */
  const lastAnswers = new Map<string, AgentProfileResolution>();
  /** The setting still names `stack` (off names none). A run that outlived its
   *  stack publishes nothing and reports nothing: the newer stack's run does. */
  const current = (stack: readonly string[]): boolean => {
    const now = deps.stack();
    return now !== undefined && sameStack(now, stack);
  };
  /** Deliveries in flight, by `host#stack`: a change of the stack is its own
   *  delivery, never folded into the one still running. */
  const inFlight = new Set<string>();

  /** Every answer asked, counted: a fresh run takes only answers asked after
   *  it started (a count, never the clock — two asks in one millisecond are
   *  still ordered). */
  let asks = 0;

  /** A remembered answer, or a new one. A run that may reuse (a connect,
   *  `since` absent) takes a settled-well answer while its schedule period
   *  has not turned; a fresh run (the user's check, the schedule) takes only
   *  one asked since it started — failed or not, so its hosts share ONE
   *  read, lock and build, and see the same answer. The PROMISE is remembered
   *  the moment it is asked, so runs that overlap share it too; a failed one
   *  is never handed to a later run, which asks again. */
  const reuse = <T>(
    memo: Map<string, Known<Promise<T>>>,
    key: string,
    run: Run,
    read: () => Promise<T>,
  ): Promise<T> => {
    const last = memo.get(key);
    if (
      last !== undefined &&
      (run.since === undefined
        ? !last.failed &&
          !updateDue(
            Math.floor(now() / 1000),
            Math.floor(last.at / 1000),
            schedule.periodSeconds,
            schedule.offsetSeconds,
          )
        : last.ask > run.since)
    )
      return last.value;
    const value = read();
    const known: Known<Promise<T>> = {
      value,
      at: now(),
      ask: ++asks,
      failed: false,
    };
    memo.set(key, known);
    value.catch(() => {
      known.failed = true;
    });
    return value;
  };

  const readIndex = (system: string, run: Run) =>
    reuse(indexed, system, run, async () => {
      const entry = await ops.published(system);
      log.info(
        { system, rev: entry.rev, ia: entry.ia, ca: entry.ca },
        "agent-distro index read",
      );
      return entry;
    });

  const readLock = (reference: string, run: Run) =>
    reuse(locks, reference, run, async () => {
      const locked = await ops.lock(reference);
      log.info(
        { reference, tree: locked.tree, rev: locked.rev },
        "agent-distro profile locked",
      );
      return locked;
    });

  const readBuild = (
    rev: string,
    locked: LockedProfile,
    hostSystem: string,
    run: Run,
  ) =>
    reuse(
      builds,
      JSON.stringify([rev, locked.tree, hostSystem]),
      run,
      async () => {
        const built = await ops.build({ rev, locked, hostSystem });
        log.info(
          { reference: locked.reference, hostSystem, path: built.path },
          "agent-distro profile built",
        );
        return built;
      },
    );

  /** Lock and build `reference` for `hostSystem`, with the package's `rev`. */
  const profileFor = async (
    run: Run,
    reference: string,
    rev: string,
    hostSystem: string,
  ): Promise<{ locked: LockedProfile; built: BuiltProfile }> => {
    const locked = await readLock(reference, run);
    return { locked, built: await readBuild(rev, locked, hostSystem, run) };
  };

  /** Say, for this machine's system, whether each profile of `stack` builds. */
  const resolveStack = async (
    stack: readonly string[],
    run: Run,
  ): Promise<void> => {
    if (stack.length === 0) {
      if (current(stack)) deps.onResolution([]);
      return;
    }
    const answers = new Map<string, AgentProfileResolution>();
    const publish = () => {
      for (const [reference, answer] of answers)
        lastAnswers.set(reference, answer);
      if (!current(stack)) return;
      deps.onResolution(
        stack.map((reference) => ({
          reference,
          resolution: answers.get(reference) ??
            lastAnswers.get(reference) ?? { kind: "pending" },
        })),
      );
    };
    publish();
    try {
      const { system } = await ops.hostNixOf("localhost");
      const { rev } = await readIndex(system, run);
      await Promise.all(
        stack.map(async (reference) => {
          try {
            const { locked, built } = await profileFor(
              run,
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
      // landing it cannot hold) — unless the setting moved on meanwhile, when
      // padi's refusal of a stale landing is the expected answer: logged at
      // error, and the outcome below is the delivery's own.
      if (
        r.kind === "delivering" ||
        current(r.kind === "landed" ? referencesOf(r.set.profiles) : r.profiles)
      )
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
    run: Run,
  ): Promise<HostOutcome> => {
    const at = { host: host.label, agentDistroProfiles: stack };
    const onProgress = (line: string) =>
      log.debug({ ...at, line }, "agent-distro delivery");
    const superseded = (): HostOutcome => {
      log.info(
        { ...at, now: deps.stack() ?? null },
        "agent-distro delivery superseded by a newer setting",
      );
      return "superseded";
    };
    const failed = async (message: string): Promise<HostOutcome> => {
      if (!current(stack)) return superseded();
      log.warn({ ...at, message }, "agent-distro set not delivered");
      await report(host, { kind: "failed", profiles: stack, message }).catch(
        () => {},
      );
      return "failed";
    };
    try {
      const hostNix = await ops.hostNixOf(host.ssh);
      const published = await readIndex(hostNix.system, run);
      const delivered: DeliveredProfile[] = [];
      for (const reference of stack) {
        let built: BuiltProfile;
        let locked: LockedProfile;
        try {
          ({ locked, built } = await profileFor(
            run,
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
      if (!current(stack)) return superseded();
      const set = { bundle: res.bundle, profiles: delivered };
      await report(host, { kind: "landed", set });
      log.info({ ...at, set }, "agent-distro set delivered");
      return "landed";
    } catch (err) {
      if (!current(stack)) return superseded();
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
      await resolveStack(stack, {});
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
      const run: Run = trigger === "connect" ? {} : { since: asks };
      // Settings learns whether each profile builds, whether or not a host is
      // reachable this run.
      const resolved = resolveStack(stack, run);
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
          ...(await Promise.all(live.map((h) => deliverOne(h, stack, run)))),
        );
        await resolved;
        return outcomes;
      } finally {
        for (const h of ours) inFlight.delete(slotOf(h));
      }
    },
  };
}
