/**
 * A kaval link that dies MID-SESSION must heal itself (juspay/kolu#2182).
 *
 * The field incident: padi's held connection died on an RPC ping timeout while
 * kaval itself was perfectly healthy, the endpoint reported `degraded`, and
 * nothing ever re-dialled — 52 minutes degraded, `ptyHostClient` throwing on
 * every call, and the only offered recovery destroying every running terminal.
 * Restarting padi BY HAND fixed it in one move, because padi's boot re-runs
 * `converge`, which ADOPTS the resident same-build kaval.
 *
 * The first suite drives that exact repair over the REAL spine: a genuine
 * `createEndpoint` at a genuine unix-socket rendezvous and the very verb the
 * BOOT takes (`convergeAndReconcile` — the converge and its post-converge
 * hooks), with the healer wired into the endpoint's own `onStatus` exactly as
 * `ensureLocalEndpoint` wires it. The connection is dropped the way the
 * transport drops it — the `onClose` the endpoint registered — and nothing in
 * the test re-converges by hand: the loop under test is the only thing that can.
 *
 * The remaining suites pin the properties that correctness rests on: the backoff
 * actually backs off and stops on success, and a DELIBERATE restart is never
 * mistaken for a link to heal — from BOTH sides of that exclusion (the
 * endpoint's own emit-guard, and the claim `restartLocalEndpoint` takes).
 *
 * Fork-free by construction: the "resident kaval" is a bare `net` listener plus
 * a gate naming THIS vitest process, the shape `converge.test.ts` uses. That
 * makes the policy choice load-bearing — see `residentPolicy`.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { silentLogger } from "@kolu/log/loggerStubs.testutil";
import { type ConvergenceIdentity, daemonBuild } from "@kolu/surface-daemon";
import {
  type EndpointState,
  instanceKeyFromStartedAt,
} from "@kolu/surface-daemon-supervisor";
import { createEndpointForKoluTest } from "@kolu/surface-daemon-supervisor/createEndpoint.kolu.testlib";
import { Effect } from "effect";
import type { PtyHostClient, PtyHostIdentity } from "kaval";
import { afterEach, describe, expect, it } from "vitest";
import type { KavalObservation } from "../kavalObservation.ts";
import type { KavalConnectionMetadata } from "./connect.ts";
import { unreachableDispatch } from "./dispatch.testlib.ts";
import {
  requireEndpointClaim,
  withConvergeClaim,
  withRestartClaim,
} from "./endpointClaim.ts";
import { type LinkLossHealer, startLinkLossHealer } from "./linkLoss.ts";
import {
  type ConvergeVerdict,
  convergeAndReconcile,
} from "./reconcileConverged.ts";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the healer's precondition answers with — the sensor's own word for what
 *  is standing at the rendezvous, which is the only vocabulary for it. */
type Observed = KavalObservation["kind"];

/** What every heal-path case below is ABOUT: the daemon is still there, and
 *  only the link to it broke. The cases that vary it name their own. */
const SERVING = Effect.succeed<Observed>("healthy");

/** The announcement seam for the cases that are not about what was announced.
 *  Spelled rather than omitted because `onRecovered` is REQUIRED: a heal nobody
 *  is told about is a silent recovery, and every case below that expects no
 *  announcement proves it by counting converges instead. */
const NO_ANNOUNCE = (): void => {};

/** Poll until `ready`, or fail loudly. The loop under test runs on real node
 *  timers (its `unref`'d, chained `setTimeout` is a deliberate design choice, not
 *  an accident to be faked away), so the suite waits on its EFFECT rather than
 *  on a duration it would otherwise have to guess. */
async function waitFor(
  what: string,
  ready: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(2);
  }
}

/** The resident daemon's serialized start instant. It is BOTH the fake
 *  connection's `startedAt` and the probe's instance key, because
 *  `characterizeHeld` correlates the two, and a mismatch reads as
 *  identity-unverifiable — a refusal instead of the adoption under test. */
const STARTED_AT = 1;

/** The contract both sides speak. A parseable `major.minor` on purpose: an
 *  unparseable version reads as a SKEW rather than a match, so a placeholder
 *  like "test" would silently move this suite off the adopt path it exists to
 *  prove. */
const CONTRACT = "1.1";

/** `refuse` on skew, not kaval's production `recycle`, and that is a SAFETY
 *  property of this suite rather than a preference: the resident's gate names
 *  this vitest process, so any arm that reaps the gate holder would SIGTERM the
 *  test runner. Refuse cannot reap. Every assertion below is on the adopt path,
 *  where the two policies behave identically. */
const residentPolicy = {
  capability: "not-drainable" as const,
  // `off-nix` makes the BUILD axis a non-question (`decide` adopts on it
  // outright), so the only thing this fixture must get right is the contract.
  baked: { contractVersion: CONTRACT, build: { kind: "off-nix" as const } },
  onContractSkew: { kind: "refuse" as const },
  onBuildMismatch: { kind: "nudge-human" as const },
};

const residentIdentity: ConvergenceIdentity = {
  contractVersion: CONTRACT,
  build: daemonBuild("resident"),
};

type KavalTestEndpoint = ReturnType<
  typeof createEndpointForKoluTest<
    PtyHostClient,
    PtyHostIdentity,
    KavalConnectionMetadata
  >
>;

interface Resident {
  readonly endpoint: KavalTestEndpoint;
  /** Drop the link the way the transport does — fire the `onClose` the endpoint
   *  registered on the connection it currently holds. THE defect's trigger. */
  dropLink(): void;
  /** Every state the endpoint published, in order. */
  readonly states: EndpointState[];
  dispose(): void;
}

/**
 * A live resident "kaval": a real accepting unix socket plus a one-field gate
 * naming a live pid — together exactly what `liveServingHolder` needs to hand
 * the adopt path a survivor. Its `driver.spawn` FAILS on purpose: a spawn here
 * would mean the survivor was NOT adopted, which is the very thing the repair
 * promises, so it must be loud rather than quietly served by a fresh daemon.
 *
 * `observe` is the healer's seam, taken at construction because that is where
 * production takes it: `ensureLocalEndpoint` builds the healer first and hands
 * the endpoint an `onStatus` that feeds it before forwarding.
 */
async function residentKaval(
  observe: (state: EndpointState) => void,
): Promise<Resident> {
  const dir = mkdtempSync(join(tmpdir(), "link-loss-"));
  const socketPath = join(dir, "k.sock");
  const gatePath = join(dir, "k.pid");
  const server: Server = createServer((c) => c.on("error", () => {}));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  writeFileSync(gatePath, `${process.pid}\n`);

  const states: EndpointState[] = [];
  let closers: Array<() => void> = [];

  const endpoint = createEndpointForKoluTest<
    PtyHostClient,
    PtyHostIdentity,
    KavalConnectionMetadata
  >({
    hostId: "local-kaval-test",
    home: { dir, gatePath, socketPath },
    policy: residentPolicy,
    probe: () =>
      Effect.sync(() => ({
        capability: "not-drainable" as const,
        identity: residentIdentity,
        instanceKey: instanceKeyFromStartedAt(STARTED_AT),
        dispose: () => {},
      })),
    driver: {
      spawn: Effect.fail(
        new Error("the resident survivor must be adopted, never replaced"),
      ),
    },
    connect: () =>
      Effect.sync(() => {
        // Each dial is its own connection generation, and only the CURRENT one's
        // close demotes the endpoint — so the closers are replaced, not appended.
        closers = [];
        return {
          client: {} as PtyHostClient,
          identity: { staleKey: "", navigableCommit: "" },
          startedAt: STARTED_AT,
          metadata: {
            contractVersion: CONTRACT,
            pid: 4242,
            // Identity-only fake: nothing here drives a wire member.
            dispatch: unreachableDispatch,
          },
          dispose: () => {},
          onClose: (cb: () => void) => {
            closers.push(cb);
          },
        };
      }),
    log: silentLogger,
    onStatus: (_hostId, status) => {
      observe(status.state);
      states.push(status.state);
    },
    socketReadyMs: 200,
    socketPollMs: 5,
    adoptConnectAttempts: 1,
    adoptConnectRetryMs: 1,
  });

  return {
    endpoint,
    dropLink: () => {
      for (const cb of closers) cb();
    },
    states,
    dispose: () => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const residents: Resident[] = [];
const healers: LinkLossHealer[] = [];

afterEach(async () => {
  // Park every healer before its fixture goes: `dead` cannot arm, and a timer
  // already pending finds a state that is not `degraded` at fire time and drops
  // itself rather than re-arming.
  for (const h of healers.splice(0)) h.observe("dead");
  await delay(0);
  for (const r of residents.splice(0)) r.dispose();
});

describe("mid-session link loss re-converges itself (#2182)", () => {
  it("re-ADOPTS the resident daemon after the held connection closes, runs the boot's own hooks, and stamps the LINK restore — never the recycle-recovery (#2184)", async () => {
    let adoptions = 0;
    let parks = 0;
    let recoveries = 0;
    // What `daemonMain` routes the verdict to: `adopted` → the link-restore
    // stamp, anything else → the recycle-recovery stamp the supervision arm
    // shares. Counted apart, because the whole defect #2184 fixes was the adopt
    // path stamping the second one and telling a still-running session it was
    // restarted and is ready to restore.
    let linkRestores = 0;
    const hooks = {
      onAdopted: Effect.sync(() => {
        adoptions += 1;
      }),
      onNotAdopted: () => {
        parks += 1;
      },
      // These cases drive the BOOT-shaped converge; the heal's "report" policy
      // is pinned by its own case below.
      onAdoptFailure: "recycle" as const,
    };

    let healer: LinkLossHealer | undefined;
    const resident = await residentKaval((s) => healer?.observe(s));
    residents.push(resident);
    const ep = resident.endpoint;
    healer = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: convergeAndReconcile(ep, hooks),
      onRecovered: (verdict) => {
        if (verdict === "adopted") linkRestores += 1;
        else recoveries += 1;
      },
      backoffMs: 10,
    });
    healers.push(healer);

    // ── boot: converge ADOPTS the resident; the healer sees `connected` ──────
    expect(await Effect.runPromise(convergeAndReconcile(ep, hooks))).toBe(
      "adopted",
    );
    expect(adoptions).toBe(1);
    expect(ep.current()).toBeDefined();

    // ── the incident: the held connection dies. Nothing else happens. ────────
    resident.dropLink();
    expect(resident.states.at(-1)).toBe("degraded");
    expect(ep.current()).toBeUndefined();

    // ── the repair: the loop re-converges, unaided ───────────────────────────
    await waitFor(
      "the link-loss heal to re-converge",
      () => linkRestores === 1,
    );

    // The link is back, and it came back by ADOPTION — the resident daemon (its
    // PTYs, its agents) was never replaced. `driver.spawn` fails loudly, so no
    // fresh daemon could have served this.
    expect(ep.current()).toBeDefined();
    expect(resident.states.at(-1)).toBe("connected");
    // The boot's own hooks ran again: a heal that adopts owes the saved session
    // exactly the reconciliation a boot adoption does.
    expect(adoptions).toBe(2);
    expect(parks).toBe(0);
    // And the client is told the truth about it: the link came back, nothing was
    // recycled. The recycle-recovery signal — whose sentence parks the session
    // for restore — was never stamped.
    expect(linkRestores).toBe(1);
    expect(recoveries).toBe(0);
  });

  it("stamps the recycle-recovery, NOT the link restore, when the heal lands on a daemon with no survivors (#2184)", async () => {
    // The other arm of the same routing: a converge that finds nothing to adopt
    // leaves a FRESH daemon and a parked session, which is exactly what the
    // supervision arm's "restarted it; your session is ready to restore" says.
    let linkRestores = 0;
    let recoveries = 0;
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: Effect.suspend(() => {
        healer?.observe("connected");
        return Effect.succeed<ConvergeVerdict>("no-survivors");
      }),
      onRecovered: (verdict) => {
        if (verdict === "adopted") linkRestores += 1;
        else recoveries += 1;
      },
      backoffMs: 5,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");
    await waitFor("the heal to settle on no survivors", () => recoveries === 1);
    expect(linkRestores).toBe(0);
  });

  // The guard that keeps this loop from becoming the hot restart loop the probe
  // arm spends a ledger to bound (`KAVAL_SUPERVISION_SPEC.unrepaired`) and that
  // `/padi` publishes as a promise. `converge` SPAWNS when it finds nobody home,
  // so "re-converge on every degraded" and "restart a dead daemon every backoff,
  // forever" would be the same program without this.
  it("does NOT converge when the daemon is GONE, and keeps asking — standing down would sit out the daemon's return", async () => {
    let converges = 0;
    let observed: Observed = "unreachable";
    const healer = startLinkLossHealer({
      stillServing: Effect.suspend(() => Effect.succeed(observed)),
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");
    // Several backoffs' worth: nothing converges, so nothing can SPAWN — which is
    // the whole of what the guard owes.
    await delay(60);
    expect(converges).toBe(0);

    // ...and the loop is STILL asking. This half is the one that matters: a
    // healer that stopped here would sit out the daemon's return forever,
    // because the probe arm does not re-dial a daemon it finds healthy — it
    // clears its ledger and recycles nothing. Without this assertion a revert to
    // the one-way stand-down still passes the half above.
    observed = "healthy";
    await waitFor(
      "the heal to resume once the socket is served again",
      () => converges === 1,
    );
  });

  it("does NOT converge on a STUCK daemon either, but keeps re-checking — a busy kaval must not be given up on", async () => {
    let converges = 0;
    let observed: Observed = "wedged";
    const healer = startLinkLossHealer({
      stillServing: Effect.suspend(() => Effect.succeed(observed)),
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");
    await delay(40);
    // Stuck is a WAIT, not a hand-off: nothing converged, and nothing spawned.
    expect(converges).toBe(0);
    // ...and the loop is still armed, so the moment the daemon answers again the
    // link is re-made without anyone touching the button.
    observed = "healthy";
    await waitFor(
      "the heal to resume once the daemon answers",
      () => converges === 1,
    );
  });

  it("does NOT heal a daemon that was never connected — a dead-on-boot endpoint keeps its old behaviour", async () => {
    let converges = 0;
    const healer = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    // A boot that never connected: `connecting` → `degraded`, no `connected`
    // between them. The latch says this is not a LOST link.
    healer.observe("connecting");
    healer.observe("degraded");
    await delay(40);
    expect(converges).toBe(0);
  });
});

describe("the heal's retry backs off, and stops the moment the link is back", () => {
  // An `incomplete` verdict is the one shape where the endpoint is CONNECTED and
  // the heal is not done: the converge re-made the link and published
  // `connected` from inside itself, then the work riding on it failed. Every
  // other retry in this loop is gated on `degraded`, so without its own latch
  // this case ends the loop with the taps still down — and announces a recovery
  // while doing it, through the one `onRecovered` arm that stamps the RECYCLE
  // sentence over a session that never stopped running.
  it("does NOT announce an `incomplete` heal, and keeps retrying it even though the endpoint is connected", async () => {
    const announced: ConvergeVerdict[] = [];
    let attempts = 0;
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: Effect.suspend(() => {
        attempts += 1;
        // A real converge publishes `connected` from inside itself, BEFORE the
        // post-converge work runs. Reproduce that ordering — it is what makes
        // the degraded-only gate drop the retry.
        healer?.observe("connected");
        return Effect.succeed<ConvergeVerdict>(
          attempts < 3 ? "incomplete" : "adopted",
        );
      }),
      onRecovered: (v) => {
        announced.push(v);
      },
      // 20ms rather than the 5ms the other cases use: this is the ONE case that
      // measures elapsed time, and the assertion below needs the gap between a
      // reset backoff and a leaked one to be wider than a loaded box's timer
      // coarseness. The streak escalates 20 → 40 → 80, so a leak is unmistakable.
      backoffMs: 20,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");

    await waitFor("the heal to finish after two incomplete rounds", () =>
      announced.includes("adopted"),
    );
    expect(attempts).toBe(3);
    // The two incomplete rounds announced NOTHING — not the reconnect line, and
    // above all not the recycle line `onRecovered`'s else-arm would have stamped.
    expect(announced).toEqual(["adopted"]);

    // ...and the incident is over, backoff included. Holding `unfinished` is what
    // stops `observe("connected")` resetting the loop, so the attempt that
    // clears the bit has to reset it — otherwise the escalated wait outlives the
    // incident and the NEXT link loss waits that long before its first attempt,
    // against a doc that promises about a second. Measure the second incident's
    // first attempt rather than reading the counter: the delay IS the claim.
    const secondIncidentAt = Date.now();
    healed.observe("degraded");
    await waitFor("the NEXT incident to start promptly", () => attempts === 4);
    // The streak escalated to 80ms (20 → 40 → 80), so a leaked backoff cannot
    // start sooner than that. 60ms sits well clear of one fresh 20ms timer and
    // well under the leak — a gap wide enough that timer coarseness on a busy
    // box cannot decide the outcome.
    expect(Date.now() - secondIncidentAt).toBeLessThan(60);
  });

  it("retries a failed re-converge on a doubled backoff, then stops on success with ONE recovery stamp", async () => {
    const startedAt: number[] = [];
    let recoveries = 0;
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      stillServing: SERVING,
      // Attempt 1 fails (the daemon is not answering yet); attempt 2 converges
      // and — as a real converge does — publishes `connected` synchronously from
      // inside itself.
      reconverge: Effect.suspend(() => {
        startedAt.push(Date.now());
        if (startedAt.length === 1) {
          return Effect.fail(new Error("dial refused"));
        }
        healer?.observe("connected");
        return Effect.succeed<ConvergeVerdict>("adopted");
      }),
      onRecovered: () => {
        recoveries += 1;
      },
      backoffMs: 20,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");
    await waitFor("two re-converge attempts", () => startedAt.length === 2);

    // The second attempt waited the DOUBLED backoff, not the first one again.
    const gap = (startedAt[1] ?? 0) - (startedAt[0] ?? 0);
    expect(gap).toBeGreaterThanOrEqual(30);
    // And the loop stopped: the link is back, so nothing re-arms.
    await delay(120);
    expect(startedAt).toHaveLength(2);
    expect(recoveries).toBe(1);
  });
});

describe("a heal that has to replace the daemon does not wait on itself (#2184)", () => {
  it("runs the fail-closed recycle inside the heal's OWN claim, and leaves the endpoint claimable afterwards", async () => {
    // The reachable path: a link dies → the healer converges → the converge
    // ADOPTS the survivor → reconciling that survivor fails → `reconcileConverged`
    // recycles, fail-CLOSED. That recycle runs on the heal's own stack, so a
    // claim taken THERE waits on the heal that is running it — a circular wait
    // bounded by nothing, which also strands the heal token and with it the
    // healer, the "Restart kaval" button and the supervision auto-recycle.
    //
    // The spine's real `recycle` is deliberately NOT driven here, for the safety
    // property `residentPolicy` states above: a destructive recycle reaps the
    // gate holder, and this fixture's gate names the vitest process. What stands
    // in for it is exactly what the production arm asserts before it recycles —
    // that the replacement is COVERED by a claim it did not take itself.
    let replacements = 0;
    const verdicts: ConvergeVerdict[] = [];
    let healer: LinkLossHealer | undefined;
    const healed = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: withConvergeClaim(
        Effect.sync(() => {
          requireEndpointClaim("the fail-closed recycle");
          replacements += 1;
          // A fail-closed recycle leaves a FRESH daemon connected, as a real one
          // does — so the loop cancels rather than healing the same link twice.
          healer?.observe("connected");
          return "recycled" as const;
        }),
      ),
      onRecovered: (verdict) => {
        verdicts.push(verdict);
      },
      backoffMs: 5,
    });
    healer = healed;
    healers.push(healed);

    healed.observe("connected");
    healed.observe("degraded");
    await waitFor(
      "the fail-closed heal to settle",
      () => verdicts.length === 1,
    );
    expect(replacements).toBe(1);
    expect(verdicts).toEqual<ConvergeVerdict[]>(["recycled"]);

    // …and the endpoint is claimable again the moment the heal is over: the
    // button's restart runs promptly instead of waiting on a heal token that
    // nothing will ever settle.
    await expect(
      Promise.race([
        Effect.runPromise(withRestartClaim(Effect.void)).then(() => "claimed"),
        delay(500).then(() => "hung"),
      ]),
    ).resolves.toBe("claimed");
  });

  it("refuses an endpoint replacement that nobody has claimed", () => {
    // Checked, not remembered: a future mutator that reaches the endpoint outside
    // every claim would race the healer silently, so it says so instead.
    expect(() => requireEndpointClaim("a stray recycle")).toThrow(/claim/);
  });
});

describe("a deliberate restart is never mistaken for a lost link", () => {
  it("the endpoint's emit-guard repaints a restart's own close as `restarting`, so the healer never arms", async () => {
    let converges = 0;
    let healer: LinkLossHealer | undefined;
    const resident = await residentKaval((s) => healer?.observe(s));
    residents.push(resident);
    const ep = resident.endpoint;
    healer = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    await Effect.runPromise(
      convergeAndReconcile(ep, { onAdoptFailure: "recycle" }),
    );
    expect(resident.states.at(-1)).toBe("connected");

    // A supervised restart tears the connection down INSIDE `holdRestarting` —
    // the emit-guard the whole trigger is built around.
    await Effect.runPromise(
      ep.holdRestarting(
        Effect.promise(async () => {
          resident.dropLink();
          await delay(5);
        }),
      ),
    );

    // The close was published as `restarting`, never as `degraded` — so the
    // healer's one trigger never fired.
    expect(resident.states).toContain("restarting");
    const sinceConnected = resident.states.slice(
      resident.states.lastIndexOf("connected") + 1,
    );
    expect(sinceConnected).not.toContain("degraded");
    await delay(40);
    expect(converges).toBe(0);
  });

  it("a heal already armed stands down while a restart holds the claim, and never converges behind it", async () => {
    let converges = 0;
    const healer = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: Effect.sync(() => {
        converges += 1;
        return "adopted" as const;
      }),
      backoffMs: 10,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    // A genuine link loss arms the loop…
    healer.observe("connected");
    healer.observe("degraded");

    // …and the user presses Restart kaval first. `restartLocalEndpoint` is this
    // wrapper over the endpoint's trigger, so the claim under test is the one
    // production takes.
    let release = (): void => {};
    const restarting = Effect.runPromise(
      withRestartClaim(
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
      ),
    );

    // Several backoffs pass while the restart owns the endpoint: every one of
    // them reschedules rather than converging.
    await delay(80);
    expect(converges).toBe(0);

    // The restart lands and reports its fresh daemon — which cancels the loop.
    release();
    await restarting;
    healer.observe("connected");
    await delay(60);
    expect(converges).toBe(0);
  });

  it("a restart WAITS OUT a heal that is already mid-converge, so the two can never overlap", async () => {
    let converging = false;
    let restartRan = false;
    let ranDuringConverge = false;
    let release = (): void => {};
    const healer = startLinkLossHealer({
      stillServing: SERVING,
      reconverge: Effect.promise(async () => {
        converging = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        converging = false;
        return "adopted" as const;
      }),
      backoffMs: 5,
      onRecovered: NO_ANNOUNCE,
    });
    healers.push(healer);

    healer.observe("connected");
    healer.observe("degraded");
    await waitFor("the heal to start converging", () => converging);

    const restarted = Effect.runPromise(
      withRestartClaim(
        Effect.sync(() => {
          restartRan = true;
          ranDuringConverge = converging;
        }),
      ),
    );
    await delay(40);
    // The restart is parked behind the heal — its body has not run at all.
    expect(restartRan).toBe(false);

    release();
    await restarted;
    // …and when it did run, the converge was already over.
    expect(restartRan).toBe(true);
    expect(ranDuringConverge).toBe(false);
    healer.observe("connected");
  });
});
