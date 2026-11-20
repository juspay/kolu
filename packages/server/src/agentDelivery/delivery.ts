import { updateDue } from "@juspay/agent-distro/update/due";
import type { UpdaterSchedule } from "@kolu/agent-distro/bake";
import {
  FAILURE_DETAIL_LINES,
  failureMessage,
  failureWords,
} from "@kolu/agent-distro/failure";
import {
  type DeliveredProfile,
  referencesOf,
  sameStack,
} from "@kolu/agent-distro/landing";
import type {
  AgentDistroDeliveryReport,
  AgentDistroSetting,
  AgentProfileResolution,
} from "@kolu/agent-distro/schema";
import type { Logger } from "@kolu/log";
import type { HostNix, PublishedClosure } from "@kolu/surface-remote";
import type { BuiltProfile, LockedProfile } from "./profiles.ts";

export type DeliveryStep<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export interface DeliveryOps {
  hostNixOf(ssh: string): Promise<DeliveryStep<HostNix>>;
  published(system: string): Promise<DeliveryStep<PublishedClosure>>;
  lock(reference: string): Promise<DeliveryStep<LockedProfile>>;
  build(args: {
    readonly rev: string;
    readonly locked: LockedProfile;
    readonly hostSystem: string;
  }): Promise<DeliveryStep<BuiltProfile>>;
  ship(args: {
    readonly ssh: string;
    readonly label: string;
    readonly hostNix: HostNix;
    readonly reference: string;
    readonly path: string;
    readonly onProgress: (line: string) => void;
  }): Promise<DeliveryStep<string>>;
  pull(args: {
    readonly ssh: string;
    readonly label: string;
    readonly hostNix: HostNix;
    readonly published: PublishedClosure;
    readonly onProgress: (line: string) => void;
  }): Promise<DeliveryStep<string>>;
}

export interface DeliveryHost {
  readonly key: string;
  readonly ssh: string;
  readonly label: string;
  report(report: AgentDistroDeliveryReport): Promise<void>;
}

export type DeliveryTrigger = "connect" | "user" | "schedule";

export type HostOutcome = "landed" | "failed" | "busy" | "superseded";

export interface AgentDelivery {
  run(opts: {
    readonly keys?: readonly string[];
    readonly trigger: DeliveryTrigger;
  }): Promise<readonly HostOutcome[]>;
  resolve(): Promise<void>;
  running(): boolean;
}

type AnswerPolicy =
  | { readonly reuse: "period" }
  | { readonly freshSince: number };

interface Known<T> {
  readonly value: T;
  readonly at: number;
  readonly ask: number;
  failed: boolean;
}

export function createAgentDelivery(deps: {
  readonly schedule: UpdaterSchedule;
  readonly ops: DeliveryOps;
  readonly log: Logger;
  readonly setting: () => AgentDistroSetting;
  readonly hosts: () => readonly DeliveryHost[];
  readonly onResolution: (
    profiles: readonly {
      readonly reference: string;
      readonly resolution: AgentProfileResolution;
    }[],
  ) => void;
  readonly now?: () => number;
}): AgentDelivery {
  const { schedule, ops, log } = deps;
  const now = deps.now ?? Date.now;
  const indexed = new Map<
    string,
    Known<Promise<DeliveryStep<PublishedClosure>>>
  >();
  const locks = new Map<string, Known<Promise<DeliveryStep<LockedProfile>>>>();
  const builds = new Map<string, Known<Promise<DeliveryStep<BuiltProfile>>>>();
  const lastAnswers = new Map<string, AgentProfileResolution>();
  const stackNow = (): readonly string[] | undefined => {
    const setting = deps.setting();
    return setting.enabled ? setting.profiles : undefined;
  };
  const padiWillTakeLanding = (stack: readonly string[]): boolean =>
    sameStack(deps.setting().profiles, stack);
  const settingsShowsStack = (stack: readonly string[]): boolean => {
    const shown = stackNow();
    return shown !== undefined && sameStack(shown, stack);
  };
  const inFlight = new Set<string>();

  let asks = 0;

  const remembered = <T>(
    memo: Map<string, Known<Promise<DeliveryStep<T>>>>,
    key: string,
    policy: AnswerPolicy,
    read: () => Promise<DeliveryStep<T>>,
  ): Promise<DeliveryStep<T>> => {
    const last = memo.get(key);
    if (
      last !== undefined &&
      ("reuse" in policy
        ? !last.failed &&
          !updateDue(
            Math.floor(now() / 1000),
            Math.floor(last.at / 1000),
            schedule.periodSeconds,
            schedule.offsetSeconds,
          )
        : last.ask > policy.freshSince)
    )
      return last.value;
    const value = read();
    const known: Known<Promise<DeliveryStep<T>>> = {
      value,
      at: now(),
      ask: ++asks,
      failed: false,
    };
    memo.set(key, known);
    value.then(
      (step) => {
        known.failed = !step.ok;
      },
      () => {
        known.failed = true;
      },
    );
    return value;
  };

  const readIndex = (system: string, policy: AnswerPolicy) =>
    remembered(indexed, system, policy, async () => {
      const entry = await ops.published(system);
      if (entry.ok)
        log.info(
          {
            system,
            rev: entry.value.rev,
            ia: entry.value.ia,
            ca: entry.value.ca,
          },
          "agent-distro index read",
        );
      return entry;
    });

  const readLock = (reference: string, policy: AnswerPolicy) =>
    remembered(locks, reference, policy, async () => {
      const locked = await ops.lock(reference);
      if (locked.ok)
        log.info(
          { reference, tree: locked.value.tree, rev: locked.value.rev },
          "agent-distro profile locked",
        );
      return locked;
    });

  const readBuild = (
    rev: string,
    locked: LockedProfile,
    hostSystem: string,
    policy: AnswerPolicy,
  ) =>
    remembered(
      builds,
      JSON.stringify([rev, locked.tree, hostSystem]),
      policy,
      async () => {
        const built = await ops.build({ rev, locked, hostSystem });
        if (built.ok)
          log.info(
            { reference: locked.reference, hostSystem, path: built.value.path },
            "agent-distro profile built",
          );
        return built;
      },
    );

  const profileFor = async (
    policy: AnswerPolicy,
    reference: string,
    rev: string,
    hostSystem: string,
  ): Promise<DeliveryStep<{ locked: LockedProfile; built: BuiltProfile }>> => {
    const locked = await readLock(reference, policy);
    if (!locked.ok) return locked;
    const built = await readBuild(rev, locked.value, hostSystem, policy);
    if (!built.ok) return built;
    return { ok: true, value: { locked: locked.value, built: built.value } };
  };

  const resolveStack = async (
    stack: readonly string[],
    policy: AnswerPolicy,
  ): Promise<void> => {
    if (stack.length === 0) {
      if (settingsShowsStack(stack)) deps.onResolution([]);
      return;
    }
    const answers = new Map<string, AgentProfileResolution>();
    const publish = () => {
      if (!settingsShowsStack(stack)) return;
      for (const [reference, answer] of answers)
        lastAnswers.set(reference, answer);
      deps.onResolution(
        stack.map((reference) => ({
          reference,
          resolution: answers.get(reference) ??
            lastAnswers.get(reference) ?? { kind: "pending" },
        })),
      );
    };
    const allFailed = (message: string) => {
      for (const reference of stack)
        answers.set(reference, { kind: "failed", message });
      publish();
    };
    publish();
    const hostNix = await ops.hostNixOf("localhost");
    if (!hostNix.ok) return allFailed(hostNix.message);
    const { system } = hostNix.value;
    const index = await readIndex(system, policy);
    if (!index.ok) return allFailed(index.message);
    const { rev } = index.value;
    await Promise.all(
      stack.map(async (reference) => {
        const got = await profileFor(policy, reference, rev, system);
        answers.set(
          reference,
          got.ok
            ? {
                kind: "resolved",
                name: got.value.built.name,
                description: got.value.built.description,
                ...(got.value.locked.rev === undefined
                  ? {}
                  : { rev: got.value.locked.rev }),
              }
            : { kind: "failed", message: got.message },
        );
        publish();
      }),
    );
  };

  const report = async (
    host: DeliveryHost,
    r: AgentDistroDeliveryReport,
  ): Promise<void> => {
    try {
      await host.report(r);
    } catch (err) {
      if (
        r.kind === "delivering" ||
        padiWillTakeLanding(
          r.kind === "landed" ? referencesOf(r.set.profiles) : r.profiles,
        )
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
    policy: AnswerPolicy,
  ): Promise<HostOutcome> => {
    const at = { host: host.label, agentDistroProfiles: stack };
    const narrated: string[] = [];
    let unnarrated = 0;
    const onProgress = (line: string) => {
      narrated.push(line);
      if (narrated.length > FAILURE_DETAIL_LINES) {
        narrated.shift();
        unnarrated++;
      }
      log.debug({ ...at, line }, "agent-distro delivery");
    };
    const superseded = async (): Promise<HostOutcome> => {
      log.info(
        { ...at, now: deps.setting().profiles },
        "agent-distro delivery superseded by a newer profile list",
      );
      await report(host, {
        kind: "failed",
        profiles: stack,
        message:
          "superseded: the Agents profile list changed while this delivery ran",
      }).catch(() => {});
      return "superseded";
    };
    const failed = async (cause: string): Promise<HostOutcome> => {
      if (!padiWillTakeLanding(stack)) return await superseded();
      const message =
        failureWords(cause).detail.length > 0
          ? cause
          : failureMessage(cause, narrated.join("\n"), unnarrated);
      log.warn({ ...at, message }, "agent-distro set not delivered");
      await report(host, { kind: "failed", profiles: stack, message }).catch(
        () => {},
      );
      return "failed";
    };
    try {
      const hostNix = await ops.hostNixOf(host.ssh);
      if (!hostNix.ok) return await failed(hostNix.message);
      const published = await readIndex(hostNix.value.system, policy);
      if (!published.ok) return await failed(published.message);
      const delivered: DeliveredProfile[] = [];
      for (const reference of stack) {
        const got = await profileFor(
          policy,
          reference,
          published.value.rev,
          hostNix.value.system,
        );
        if (!got.ok)
          return await failed(`the ${reference} profile: ${got.message}`);
        const { locked, built } = got.value;
        const shipped = await ops.ship({
          ssh: host.ssh,
          label: host.label,
          hostNix: hostNix.value,
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
          path: shipped.value,
        });
      }
      const res = await ops.pull({
        ssh: host.ssh,
        label: host.label,
        hostNix: hostNix.value,
        published: published.value,
        onProgress,
      });
      if (!res.ok) return await failed(res.message);
      if (!padiWillTakeLanding(stack)) return await superseded();
      const set = { bundle: res.value, profiles: delivered };
      await report(host, { kind: "landed", set });
      log.info({ ...at, set }, "agent-distro set delivered");
      return "landed";
    } catch (err) {
      if (!padiWillTakeLanding(stack)) return await superseded();
      log.warn({ ...at, err }, "agent-distro delivery failed");
      return await failed(err instanceof Error ? err.message : String(err));
    }
  };

  return {
    running: () => inFlight.size > 0,
    resolve: async () => {
      const stack = stackNow();
      if (stack === undefined) {
        deps.onResolution([]);
        return;
      }
      await resolveStack(stack, { reuse: "period" });
    },
    run: async ({ keys, trigger }) => {
      const stack = stackNow();
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
      const policy: AnswerPolicy =
        trigger === "connect" ? { reuse: "period" } : { freshSince: asks };
      const resolved = resolveStack(stack, policy);
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
        const live = started.filter((h): h is DeliveryHost => h !== undefined);
        outcomes.push(
          ...ours.filter((h) => !live.includes(h)).map(() => "failed" as const),
        );
        outcomes.push(
          ...(await Promise.all(live.map((h) => deliverOne(h, stack, policy)))),
        );
        await resolved;
        return outcomes;
      } finally {
        for (const h of ours) inFlight.delete(slotOf(h));
      }
    },
  };
}
