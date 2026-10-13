/**
 * Delivering agent-distro's bundles to every host — kolu-server's half of the
 * Agents setting. ONE closure-delivery route (`@kolu/surface-remote`'s
 * `deliverClosure`, the route padi itself rides to a host), driven on
 * agent-distro's clock, not kolu's: upstream's flake is locked once per run,
 * each host's bundle is evaluated for that host's system, read out of
 * agent-distro's binary cache, shipped to the host (content-addressed to a
 * Linux host, so no Nix setting anywhere has to trust it) and rooted there —
 * and NEVER built, on any arm. The host's padi is told each step
 * (`agentDistro.report`) and points `current` at what landed.
 *
 * Why a run happens decides one thing ({@link DeliveryTrigger}): a host taking
 * the setting (`connect`: every bind, reconnect and real change) reuses the
 * current schedule period's lock — a reconnect does not re-ask GitHub — while
 * the user's check (`user`) and upstream's schedule (`schedule`) lock afresh.
 *
 * The Nix steps are {@link DeliveryOps} (`./nix.ts` in production, which
 * holds none of its own: every step is `@kolu/surface-remote`'s), so the
 * policy here is testable without Nix.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import type { AgentDistroDeliveryReport } from "@kolu/agent-distro/schema";
import { updateDue } from "@kolu/agent-distro/schedule";
import type { Logger } from "@kolu/log";
import { type DeliverClosureResult, isLocalHost } from "@kolu/surface-remote";

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
   *  it there, never building. `system` is the host's (it decides the form
   *  the bundle travels in); the result names the path the host holds. */
  deliver(args: {
    readonly ssh: string;
    readonly system: string;
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
  /** A delivery (or the lock before one) is in flight. */
  running(): boolean;
}

/** The words for a delivery that did not land, by how it did not — Nix's own
 *  line inside kolu-server's. A Linux host is sent the content-addressed
 *  bundle, which no Nix refuses; only a Mac's signed bundle can be refused —
 *  by the Mac's Nix, or by this machine's while taking it from the cache —
 *  and each refusal carries the one-line fix for the machine that refused. */
function notDeliveredMessage(
  bake: AgentDistroDelivery,
  host: DeliveryHost,
  profile: string,
  system: string,
  res: Exclude<DeliverClosureResult, { ok: true }>,
): string {
  if (res.kind === "failed") return res.reason;
  switch (res.why) {
    case "refused":
      return isLocalHost(host.ssh)
        ? `this Mac's Nix would not take the signed agents: ${res.reason}. Add the user kolu runs as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${bake.cache.publicKey}) to \`nix.settings.trusted-public-keys\`.`
        : `${host.label}'s Nix would not take the signed agents: ${res.reason}. On that Mac, add the login kolu connects as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${bake.cache.publicKey}) to \`nix.settings.trusted-public-keys\`.`;
    case "sender-refused":
      return `the Nix on the machine running kolu would not take ${host.label}'s signed agents from agent-distro's cache (${bake.cache.url}), so ${host.label} was never asked: ${res.reason}. On the machine running kolu, add the user kolu runs as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${bake.cache.publicKey}) to \`nix.settings.trusted-public-keys\`.`;
    case "uncached":
      return `agent-distro's cache (${bake.cache.url}) did not deliver the ${profile} agents for ${system} — kolu never builds them: ${res.reason}`;
    case "unshipped":
      return `could not copy the agents to ${host.label}: ${res.reason}`;
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
    let system = "?";
    try {
      const locked = await ref;
      system = await ops.systemOf(host.ssh);
      const out = await outPathFor(locked, system);
      const res = await ops.deliver({
        ssh: host.ssh,
        system,
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
      const message = notDeliveredMessage(bake, host, profile, system, res);
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
