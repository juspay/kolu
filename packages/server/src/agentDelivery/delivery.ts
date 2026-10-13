/**
 * Delivering agent-distro's bundles to every host — kolu-server's half of the
 * Agents setting. ONE closure-delivery route (`@kolu/surface-remote`'s
 * `deliverClosure`, the route padi itself rides to a host), driven on
 * agent-distro's clock, not kolu's: upstream's flake is locked once per run,
 * each host's bundle is evaluated for that host's system, copied out of
 * agent-distro's binary cache into this machine's store, shipped to the host
 * and rooted there — and NEVER built, on any arm. The host's padi is told each
 * step (`agentDistro.report`) and points `current` at what landed.
 *
 * A host whose Nix refuses the shipped paths (it trusts neither the login kolu
 * reaches it as nor the cache's key) gets no agents from kolu, and is told so —
 * typed `refused`, with Nix's own words and the cache it would need to trust.
 * Only that host's settings change it, so a refusal is never retried on a loop:
 * the next scheduled run, a reconnect, or the user's own check asks again.
 *
 * The Nix steps are {@link DeliveryOps} (`./nix.ts` in production), so the
 * policy here is testable without Nix.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import { updateDue } from "@kolu/agent-distro/schedule";
import type { Logger } from "@kolu/log";
import type { DeliverClosureResult } from "@kolu/surface-remote";

/** The Nix steps of a delivery. Each throws with Nix's own words. */
export interface DeliveryOps {
  /** Lock upstream's flake (`nix flake metadata --refresh`): the locked ref. */
  lock(signal?: AbortSignal): Promise<string>;
  /** The Nix system of the host `ssh` reaches (`localhost` for this one). */
  systemOf(ssh: string, signal?: AbortSignal): Promise<string>;
  /** The output path of `profile`'s bundle for `system` at `ref` — evaluated,
   *  never built. */
  outPath(
    ref: string,
    system: string,
    profile: string,
    signal?: AbortSignal,
  ): Promise<string>;
  /** The route: get `outPath` into the host's store from the cache and root
   *  it there, never building. */
  deliver(args: {
    readonly ssh: string;
    readonly outPath: string;
    readonly profile: string;
    readonly onProgress: (line: string) => void;
    readonly signal?: AbortSignal;
  }): Promise<DeliverClosureResult>;
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

/** How one host's delivery ended: `landed`, `refused` (its Nix will not take
 *  the bundle — no retry until asked), or `failed` (anything else, retried on
 *  upstream's schedule), or `busy` (a delivery to it was already running). */
export type HostOutcome = "landed" | "refused" | "failed" | "busy";

export interface AgentDelivery {
  /** Deliver to `keys` (every connected host when omitted). `freshLock`
   *  re-locks upstream's flake; otherwise a lock from the current schedule
   *  period is reused (a reconnect does not re-ask GitHub). Resolves with each
   *  host's outcome once every one has ended; never rejects. A no-op while
   *  agents are off. */
  run(opts: {
    readonly keys?: readonly string[];
    readonly freshLock: boolean;
  }): Promise<readonly HostOutcome[]>;
  /** A delivery (or the lock before one) is in flight. */
  running(): boolean;
}

/** The words for a delivery that did not land, by how it did not. */
function notDeliveredReport(
  bake: AgentDistroDelivery,
  host: DeliveryHost,
  profile: string,
  system: string,
  res: Exclude<DeliverClosureResult, { ok: true }>,
): Extract<AgentDistroDeliveryReport, { kind: "failed" }> {
  if (res.kind === "failed")
    return {
      kind: "failed",
      profile,
      reason: "delivery",
      message: res.reason,
    };
  switch (res.why) {
    case "refused":
      return {
        kind: "failed",
        profile,
        reason: "refused",
        message: `${host.label}'s Nix refused the agents kolu copied there (${res.reason}). agent-distro's cache is ${bake.cache.url}, key ${bake.cache.publicKey}.`,
      };
    case "uncached":
      return {
        kind: "failed",
        profile,
        reason: "delivery",
        message: `agent-distro's cache (${bake.cache.url}) did not deliver the ${profile} agents for ${system} — kolu never builds them: ${res.reason}`,
      };
    case "unshipped":
      return {
        kind: "failed",
        profile,
        reason: "delivery",
        message: `could not copy the agents to ${host.label}: ${res.reason}`,
      };
    default:
      return res.why satisfies never;
  }
}

export function createAgentDelivery(deps: {
  readonly bake: AgentDistroDelivery;
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
  const { bake, ops, log } = deps;
  const now = deps.now ?? Date.now;
  let lock: { readonly ref: string; readonly at: number } | undefined;
  let locking: Promise<string> | undefined;
  const inFlight = new Set<string>();
  /** Evaluated bundle outPaths by `ref#system.profile` — the PROMISE, so hosts
   *  of one system delivered to concurrently share one evaluation. */
  const outPaths = new Map<string, Promise<string>>();
  const outPathOf = (
    ref: string,
    system: string,
    profile: string,
  ): Promise<string> => {
    const key = `${ref}#${system}.${profile}`;
    let out = outPaths.get(key);
    if (out === undefined) {
      out = ops.outPath(ref, system, profile);
      outPaths.set(key, out);
      // A failed evaluation is not remembered: the next run asks again.
      out.catch(() => outPaths.delete(key));
    }
    return out;
  };

  /** The locked ref: a fresh lock, or the current period's when allowed. One
   *  lock at a time — concurrent asks share it. */
  const lockedRef = (fresh: boolean): Promise<string> => {
    const t = Math.floor(now() / 1000);
    if (
      !fresh &&
      lock !== undefined &&
      !updateDue(t, Math.floor(lock.at / 1000), bake.schedule)
    )
      return Promise.resolve(lock.ref);
    locking ??= ops
      .lock()
      .then((ref) => {
        lock = { ref, at: now() };
        log.info({ ref }, "agent-distro locked");
        return ref;
      })
      .finally(() => {
        locking = undefined;
      });
    return locking;
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
    ref: Promise<string>,
  ): Promise<HostOutcome> => {
    const at = { host: host.label, agentDistroProfile: profile };
    let system = "?";
    try {
      const locked = await ref;
      system = await ops.systemOf(host.ssh);
      const out = await outPathOf(locked, system, profile);
      const res = await ops.deliver({
        ssh: host.ssh,
        outPath: out,
        profile,
        onProgress: (line) =>
          log.debug({ ...at, line }, "agent-distro delivery"),
      });
      if (res.ok) {
        await report(host, { kind: "landed", profile, bundle: res.outPath });
        log.info(
          { ...at, bundle: res.outPath },
          "agent-distro bundle delivered",
        );
        return "landed";
      }
      const failed = notDeliveredReport(bake, host, profile, system, res);
      log.warn(
        { ...at, reason: failed.reason, message: failed.message },
        "agent-distro bundle not delivered",
      );
      await report(host, failed);
      return failed.reason === "refused" ? "refused" : "failed";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ ...at, err }, "agent-distro delivery failed");
      await report(host, {
        kind: "failed",
        profile,
        reason: "delivery",
        message,
      }).catch(() => {});
      return "failed";
    }
  };

  return {
    running: () => inFlight.size > 0 || locking !== undefined,
    run: async ({ keys, freshLock }) => {
      const profile = deps.bundle();
      if (profile === undefined) return [];
      const targets = deps
        .hosts()
        .filter((h) => keys === undefined || keys.includes(h.key));
      const ours: DeliveryHost[] = [];
      const outcomes: HostOutcome[] = [];
      for (const host of targets) {
        if (inFlight.has(host.key)) outcomes.push("busy");
        else {
          inFlight.add(host.key);
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
        const ref = lockedRef(freshLock);
        outcomes.push(
          ...(await Promise.all(live.map((h) => deliverOne(h, profile, ref)))),
        );
        return outcomes;
      } finally {
        for (const h of ours) inFlight.delete(h.key);
      }
    },
  };
}
