/**
 * The supervision DECISION core (juspay/kolu#2101 N1) — the truth table behind
 * "how many bad probes before padi recycles its own kaval, and how many recycles
 * before it stops trying".
 *
 * The end-to-end field reproduction (a REAL kaval, SIGSTOP'd, repaired by a real
 * padi) is `kavalComa.daemon.test.ts`. This file pins what that test cannot
 * observe cheaply: the interleaving rule, the transient negative, and the
 * stand-down.
 */
import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  classifyKavalProbe,
  type KavalObservation,
} from "./kavalObservation.ts";
import {
  KAVAL_SUPERVISION_SPEC,
  makeKavalSupervisor,
} from "./kavalSupervision.ts";

const WEDGED: KavalObservation = {
  kind: "wedged",
  err: new Error("timed out"),
};
const UNREACHABLE: KavalObservation = { kind: "unreachable" };
const HEALTHY: KavalObservation = { kind: "healthy" };

function silentLog() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function harness(repairImpl?: () => Effect.Effect<void, unknown>) {
  const repair = vi.fn(repairImpl ?? (() => Effect.void));
  const onRecovered = vi.fn();
  const log = silentLog();
  const supervisor = makeKavalSupervisor({ repair, log, onRecovered });
  const feed = async (...observations: KavalObservation[]): Promise<void> => {
    for (const o of observations)
      await Effect.runPromise(supervisor.observe(o));
  };
  return { repair, onRecovered, log, feed };
}

describe("classifyKavalProbe — the three verdicts a probe can prove", () => {
  it("a REJECTED probe is `wedged` — the field shape (accepts, then nothing)", () => {
    const err = new Error("timed out after 5000ms");
    expect(classifyKavalProbe({ ok: false, err })).toEqual({
      kind: "wedged",
      err,
    });
  });

  it("a DIAL that found no socket is `unreachable`, not `wedged`", () => {
    // The dial rides `Effect.promise`, so an `ENOENT` arrives as a DEFECT rather
    // than through the probe's own no-listener fold. Same fact, same class — read
    // with the probe's own predicate so the two spellings cannot drift.
    const err = Object.assign(new Error("connect ENOENT"), { code: "ENOENT" });
    expect(classifyKavalProbe({ ok: false, err })).toEqual({
      kind: "unreachable",
    });
  });

  it("an ALL-NULL probe is `unreachable` — the honest 'no listener' fold", () => {
    expect(
      classifyKavalProbe({
        ok: true,
        probe: {
          terminalCount: null,
          buildCommit: null,
          contractVersion: null,
        },
      }),
    ).toEqual({ kind: "unreachable" });
  });

  it("an ANSWERED probe is healthy — including a kaval with zero terminals", () => {
    expect(
      classifyKavalProbe({
        ok: true,
        probe: { terminalCount: 0, buildCommit: null, contractVersion: "4.1" },
      }),
    ).toEqual({ kind: "healthy" });
  });
});

describe("makeKavalSupervisor — a streak, not a blip, is what recycles a daemon", () => {
  it("ONE slow probe triggers nothing (the transient negative)", async () => {
    const { repair, feed } = harness();
    await feed(WEDGED);
    expect(repair).not.toHaveBeenCalled();
  });

  it("recycles at the wedged ceiling, and NOT one probe earlier", async () => {
    const { repair, feed } = harness();
    await feed(WEDGED, WEDGED);
    expect(repair).not.toHaveBeenCalled();
    await feed(WEDGED);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("a healthy probe in the middle of a streak forgives it entirely", async () => {
    const { repair, feed } = harness();
    await feed(WEDGED, WEDGED, HEALTHY, WEDGED, WEDGED);
    expect(repair).not.toHaveBeenCalled();
    await feed(WEDGED);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("`unreachable` has its OWN run — a mixed streak does not recycle early", async () => {
    // The anti-conflation property the ledger exists for: two wedged plus two
    // unreachable is four failures but neither class's ceiling, so a shared
    // counter would have fired here and the ledger must not.
    const { repair, feed } = harness();
    await feed(WEDGED, UNREACHABLE, WEDGED, UNREACHABLE);
    expect(repair).not.toHaveBeenCalled();
  });

  it("a coma that FLAPS between refuse and hang still exhausts", async () => {
    // The interleaving rule stated on the spec: neither failing class resets the
    // other, so a daemon alternating "dial refused" and "accepts then hangs" —
    // the field's own presentation at wake — cannot talk the supervisor out of
    // its verdict. It costs 5 ticks instead of 3; it does not cost the repair.
    const { repair, feed } = harness();
    await feed(WEDGED, UNREACHABLE, WEDGED, UNREACHABLE);
    expect(repair).not.toHaveBeenCalled();
    await feed(WEDGED);
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("logs ONE structured line per decision, naming the verdict and the run", async () => {
    const { log, feed } = harness();
    await feed(WEDGED, WEDGED, WEDGED);
    expect(log.error).toHaveBeenCalledTimes(1);
    const [ctx, msg] = log.error.mock.calls[0]!;
    expect(ctx).toMatchObject({ verdict: "wedged", run: 3, ceiling: 3 });
    expect(msg).toContain("recycling the daemon");
  });

  it("says NOTHING per tick while the streak is still building", async () => {
    const { log, feed } = harness();
    await feed(WEDGED, WEDGED);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).not.toHaveBeenCalled();
  });
});

describe("makeKavalSupervisor — the repair budget", () => {
  /** A kaval that stays comatose: each repair "succeeds" (a fresh daemon
   *  connects) and every probe after it still fails — the exact shape that would
   *  make a naive supervisor loop hot forever. */
  const stayComatose = async (
    feed: (...o: KavalObservation[]) => Promise<void>,
  ) => {
    for (let i = 0; i < 4; i += 1) await feed(WEDGED, WEDGED, WEDGED);
  };

  it("each repair must be EARNED by a fresh streak — the reset rule", async () => {
    const { repair, feed } = harness();
    await feed(WEDGED, WEDGED, WEDGED);
    expect(repair).toHaveBeenCalledTimes(1);
    // The `unrepaired` recording zeroed both failing runs, so the very next
    // wedged probe is run 1, not run 4.
    await feed(WEDGED, WEDGED);
    expect(repair).toHaveBeenCalledTimes(1);
    await feed(WEDGED);
    expect(repair).toHaveBeenCalledTimes(2);
  });

  it("stands down at the repair ceiling instead of respawning forever", async () => {
    const { repair, log, feed } = harness();
    await stayComatose(feed);
    expect(repair).toHaveBeenCalledTimes(
      KAVAL_SUPERVISION_SPEC.unrepaired.ceiling ?? Number.NaN,
    );
    expect(
      log.error.mock.calls.some(([, msg]) =>
        String(msg).includes("standing down"),
      ),
    ).toBe(true);
  });

  it("a healthy probe re-arms the stood-down supervisor", async () => {
    const { repair, feed } = harness();
    await stayComatose(feed);
    const spent = repair.mock.calls.length;
    await feed(HEALTHY);
    await feed(WEDGED, WEDGED, WEDGED);
    expect(repair).toHaveBeenCalledTimes(spent + 1);
  });

  it("a FAILED repair is logged and never rejects out of the supervisor", async () => {
    const boom = new Error("respawn refused");
    const { log, feed } = harness(() => Effect.fail(boom));
    await expect(feed(WEDGED, WEDGED, WEDGED)).resolves.toBeUndefined();
    expect(
      log.error.mock.calls.some(
        ([ctx]) => (ctx as { err?: unknown }).err === boom,
      ),
    ).toBe(true);
  });
});

describe("makeKavalSupervisor — announcing a recovery", () => {
  it("announces only after a probe PROVES the recycled daemon serves", async () => {
    const { onRecovered, feed } = harness();
    await feed(WEDGED, WEDGED, WEDGED);
    // The repair resolved — which proves only that a fresh kaval connected, and
    // connecting is exactly what the comatose one did too.
    expect(onRecovered).not.toHaveBeenCalled();
    await feed(HEALTHY);
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("never announces a kaval that was healthy all along", async () => {
    const { onRecovered, feed } = harness();
    await feed(HEALTHY, HEALTHY, WEDGED, HEALTHY);
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
