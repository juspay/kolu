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
 * Why a run happens decides two things ({@link DeliveryTrigger}):
 *
 *   - a host taking the setting (`connect`: every bind, reconnect and real
 *     change) reuses the current schedule period's lock — a reconnect does not
 *     re-ask GitHub — and does NOT re-ship to a host whose Nix last REFUSED
 *     this bundle: it replays that refusal. Only the host's own settings
 *     change a refusal, so a flapping link must not re-copy against it;
 *   - the user's check (`user`) and upstream's schedule (`schedule`) lock
 *     afresh and ask every host again, refusals included.
 *
 * The Nix steps are {@link DeliveryOps} (`./nix.ts` in production, which
 * holds none of its own: every step is `@kolu/surface-remote`'s), so the
 * policy here is testable without Nix.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import { updateDue } from "@kolu/agent-distro/schedule";
import type { Logger } from "@kolu/log";
import type { DeliverClosureResult } from "@kolu/surface-remote";

/** The Nix steps of a delivery. Each throws with Nix's own words. */
export interface DeliveryOps {
  /** Lock upstream's flake now: the locked ref. */
  lock(): Promise<string>;
  /** The Nix system of the host `ssh` reaches (`localhost` for this one). */
  systemOf(ssh: string): Promise<string>;
  /** The output path of `profile`'s bundle for `system` at `ref` — evaluated,
   *  never built. */
  outPath(ref: string, system: string, profile: string): Promise<string>;
  /** The route: get `outPath` into the host's store from the cache and root
   *  it there, never building. */
  deliver(args: {
    readonly ssh: string;
    readonly outPath: string;
    readonly profile: string;
    readonly onProgress: (line: string) => void;
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

/** Why a run happens — see the module header. */
export type DeliveryTrigger = "connect" | "user" | "schedule";

/** How one host's delivery ended: `landed`; `refused` (a Nix — the host's or
 *  this machine's — will not take the bundle: no retry until asked); `failed`
 *  (anything else, retried on upstream's schedule); or `busy` (a delivery of
 *  that bundle to it was already running). */
export type HostOutcome = "landed" | "refused" | "failed" | "busy";

export interface AgentDelivery {
  /** Deliver to `keys` (every connected host when omitted), for `trigger`.
   *  Resolves with each host's outcome once every one has ended; never
   *  rejects. A no-op while agents are off. */
  run(opts: {
    readonly keys?: readonly string[];
    readonly trigger: DeliveryTrigger;
  }): Promise<readonly HostOutcome[]>;
  /** A delivery (or the lock before one) is in flight. */
  running(): boolean;
}

type FailedReport = Extract<AgentDistroDeliveryReport, { kind: "failed" }>;

/** The report for a delivery that did not land, by how it did not. The
 *  message is Nix's own words, with the cache when a refusal names it: what a
 *  refusal MEANS and its fix are worded once, by reason, in
 *  `@kolu/agent-distro/status`. */
function notDeliveredReport(
  bake: AgentDistroDelivery,
  host: DeliveryHost,
  profile: string,
  system: string,
  res: Exclude<DeliverClosureResult, { ok: true }>,
): FailedReport {
  const failed = (
    reason: FailedReport["reason"],
    message: string,
  ): FailedReport => ({ kind: "failed", profile, reason, message });
  if (res.kind === "failed") return failed("delivery", res.reason);
  const cache = `agent-distro's cache: ${bake.cache.url}, key ${bake.cache.publicKey}`;
  switch (res.why) {
    case "refused":
      return failed("refused", `${res.reason} (${cache})`);
    case "sender-refused":
      return failed("binderRefused", `${res.reason} (${cache})`);
    case "uncached":
      return failed(
        "delivery",
        `agent-distro's cache (${bake.cache.url}) did not deliver the ${profile} agents for ${system} — kolu never builds them: ${res.reason}`,
      );
    case "unshipped":
      return failed(
        "delivery",
        `could not copy the agents to ${host.label}: ${res.reason}`,
      );
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
  /** Deliveries in flight, by `host#bundle`: a switch to ANOTHER profile is
   *  its own delivery, never folded into the one still running. */
  const inFlight = new Set<string>();
  /** The last refusal of `host#bundle`, replayed to a reconnecting host
   *  instead of re-shipping against a Nix that refuses every time. Cleared
   *  when that bundle lands there, or a user's or the schedule's run asks. */
  const refusals = new Map<string, FailedReport>();

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
    /** One evaluation per system per run, shared by its hosts. */
    outPathFor: (ref: string, system: string) => Promise<string>,
  ): Promise<HostOutcome> => {
    const at = { host: host.label, agentDistroProfile: profile };
    const slot = `${host.key}#${profile}`;
    let system = "?";
    try {
      const locked = await ref;
      system = await ops.systemOf(host.ssh);
      const out = await outPathFor(locked, system);
      const res = await ops.deliver({
        ssh: host.ssh,
        outPath: out,
        profile,
        onProgress: (line) =>
          log.debug({ ...at, line }, "agent-distro delivery"),
      });
      if (res.ok) {
        refusals.delete(slot);
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
      const refused = failed.reason !== "delivery";
      if (refused) refusals.set(slot, failed);
      await report(host, failed);
      return refused ? "refused" : "failed";
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
        const refusal = refusals.get(slot);
        if (trigger === "connect" && refusal !== undefined) {
          // A reconnect is not a reason to re-ship to a Nix that refused:
          // tell the (fresh) padi what it said, and wait to be asked.
          outcomes.push(
            await report(host, refusal).then(
              () => "refused" as const,
              () => "failed" as const,
            ),
          );
        } else if (inFlight.has(slot)) outcomes.push("busy");
        else {
          refusals.delete(slot);
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
        const ref = lockedRef(trigger !== "connect");
        const evaluations = new Map<string, Promise<string>>();
        const outPathFor = (locked: string, system: string) => {
          let out = evaluations.get(system);
          if (out === undefined) {
            out = ops.outPath(locked, system, profile);
            evaluations.set(system, out);
          }
          return out;
        };
        outcomes.push(
          ...(await Promise.all(
            live.map((h) => deliverOne(h, profile, ref, outPathFor)),
          )),
        );
        return outcomes;
      } finally {
        for (const h of ours) inFlight.delete(`${h.key}#${profile}`);
      }
    },
  };
}
