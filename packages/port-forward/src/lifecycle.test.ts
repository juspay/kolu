/**
 * The forward map's lifecycle, driven systematically rather than one bug at a
 * time.
 *
 * This suite exists because of how the map was built: five review rounds found
 * teardown defects, and three of them were introduced by the fix for the one
 * before — each a different interleaving of the same four states. Patching them
 * individually kept producing the next adjacent hole, so the states and the
 * events that move between them are enumerated here instead.
 *
 *   states  (none) · opening · open · closing
 *   events  create · cancel · dispose · lost · fault · close✓ · close✗
 *
 * Two invariants are checked everywhere, because every defect found so far was
 * a violation of one of them:
 *
 *   **Never lose a listener.** If a close did not succeed, the forward stays in
 *   the map — visible to `list`, retryable by `cancel`. The map may only forget
 *   a forward it knows is gone.
 *
 *   **Never publish a corpse.** A forward the mechanism has reported `gone` is
 *   never handed to a caller or listed as live.
 */

import { describe, expect, it } from "vitest";
import { makeForwardManager } from "./manager.ts";
import type { ForwardLoss } from "./manager.ts";
import type { ForwardMechanisms, ForwardReport } from "./mechanism.ts";
import type { ForwardTarget } from "./target.ts";

const PU: ForwardTarget = {
  kind: "remote",
  host: "pu-dev",
  port: 5173,
  loopback: "v4",
};

/** A mechanism whose every step is under the test's control: when the open
 *  resolves, whether the close succeeds, and when either happens. */
function scripted(script: {
  /** Called with the report channel the moment `open` is entered. */
  onOpen?: (report: ForwardReport) => void;
  /** Resolve the open only when the test says so. */
  deferOpen?: boolean;
  /** How many times `close` refuses before it starts working. */
  refuseCloses?: number;
  /** Hold `close` until released. */
  deferClose?: boolean;
  /** Make the mechanism's `open` REJECT — no listener is ever produced. */
  openFails?: boolean;
}) {
  let releaseOpen: (() => void) | undefined;
  /** Once the test has let opens through, LATER opens do not wait either — a
   *  second create must be able to open a fresh listener without the test
   *  having to predict how many opens the map will make. */
  let opensFlowing = false;
  let releaseClose: ((fail?: Error) => void) | undefined;
  let refusals = script.refuseCloses ?? 0;
  let closes = 0;
  const mechanisms: ForwardMechanisms = {
    open: async ({ report }) => {
      script.onOpen?.(report);
      if (script.deferOpen === true && !opensFlowing) {
        await new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
      }
      if (script.openFails === true) {
        throw new Error("the mechanism could not open anything");
      }
      return {
        localPort: 4123 + closes,
        close: async () => {
          closes += 1;
          if (script.deferClose === true) {
            await new Promise<void>((resolve, reject) => {
              releaseClose = (fail) =>
                fail === undefined ? resolve() : reject(fail);
            });
          }
          if (refusals > 0) {
            refusals -= 1;
            throw new Error("close refused");
          }
        },
      };
    },
  };
  return {
    mechanisms,
    openArrives: () => {
      opensFlowing = true;
      releaseOpen?.();
    },
    closeSettles: (fail?: Error) => releaseClose?.(fail),
    closeCount: () => closes,
  };
}

function mapOf(script: Parameters<typeof scripted>[0]) {
  const rig = scripted(script);
  const reports: ForwardLoss[] = [];
  const forwards = makeForwardManager({
    mechanisms: rig.mechanisms,
    onLost: (loss) => reports.push(loss),
  });
  return { ...rig, forwards, reports };
}

describe("never lose a listener", () => {
  it("a cancel whose close refuses keeps the forward listed and retryable", async () => {
    const { forwards } = mapOf({ refuseCloses: 1 });
    const forward = await forwards.create(PU);

    await expect(forwards.cancel(forward.key)).rejects.toThrow(/refused/);
    expect(forwards.list()).toEqual([forward]);

    await forwards.cancel(forward.key);
    expect(forwards.list()).toEqual([]);
  });

  it("a dispose whose close refuses keeps the forward listed and retryable", async () => {
    const { forwards } = mapOf({ refuseCloses: 1 });
    await forwards.create(PU);

    await expect(forwards.dispose()).rejects.toThrow(AggregateError);
    expect(forwards.list()).toHaveLength(1);
  });

  it("a fault keeps the forward — it may still be reachable", async () => {
    let report: ForwardReport | undefined;
    const { forwards, reports } = mapOf({ onOpen: (r) => (report = r) });
    const forward = await forwards.create(PU);

    report?.fault("listener broke and would not close");

    expect(forwards.list()).toEqual([forward]);
    expect(reports.map((r) => r.kind)).toEqual(["degraded"]);
  });

  it("a fault DURING the open keeps it too, when it cannot be closed", async () => {
    // The round-six regression: the opening path collapsed fault into loss and
    // dropped the map's only handle on a listener that was still there.
    let report: ForwardReport | undefined;
    const { forwards, reports } = mapOf({
      onOpen: (r) => {
        report = r;
        r.fault("broke while coming up");
      },
      refuseCloses: 1,
    });

    const forward = await forwards.create(PU);

    expect(report).toBeDefined();
    expect(forwards.list()).toEqual([forward]);
    expect(reports.map((r) => r.kind)).toEqual(["degraded"]);
  });

  it("a fault during the open that CAN be closed yields nothing, cleanly", async () => {
    const { forwards, closeCount } = mapOf({
      onOpen: (r) => r.fault("broke while coming up"),
    });

    await expect(forwards.create(PU)).rejects.toThrow(/broke as it came up/);
    expect(forwards.list()).toEqual([]);
    expect(closeCount()).toBe(1);
  });
});

/** The opening window, COMPOSED rather than sampled.
 *
 *  Round seven found the hole this replaces: the suite tested "a fault during
 *  the open" and "a dispose racing an open" as separate cases and never crossed
 *  them, so both inverted outcomes of the combination passed unnoticed — dispose
 *  rejecting over an empty map, and dispose succeeding over a retained one.
 *  Every combination is generated here, and each is checked against the same
 *  two invariants rather than a hand-written expectation. */
describe("the opening window, every combination", () => {
  const OPENS = [
    { label: "open succeeds", openFails: false },
    { label: "open rejects", openFails: true },
  ] as const;
  const REPORTS = ["lost", "fault"] as const;
  const CLOSES = [
    { label: "close succeeds", refuseCloses: 0 },
    { label: "close refuses", refuseCloses: 1 },
  ] as const;
  const DISPOSALS = [false, true] as const;

  for (const opening of OPENS) {
    for (const report of REPORTS) {
      for (const close of CLOSES) {
        for (const disposing of DISPOSALS) {
          it(`${opening.label} · ${report} during the open · ${close.label} · ${disposing ? "dispose races it" : "no dispose"}`, async () => {
            const rig = mapOf({
              deferOpen: true,
              openFails: opening.openFails,
              refuseCloses: close.refuseCloses,
              onOpen: (r) => {
                if (report === "lost") r.lost("gone while coming up");
                else r.fault("broke while coming up");
              },
            });
            const { forwards } = rig;

            const creating = forwards.create(PU).then(
              (f) => ({ ok: true as const, f }),
              (e: Error) => ({ ok: false as const, e }),
            );
            const disposal = disposing
              ? forwards.dispose().then(
                  () => ({ failed: false }),
                  () => ({ failed: true }),
                )
              : undefined;
            rig.openArrives();
            const created = await creating;
            const disposed = await disposal;

            const listed = forwards.list();
            // Nothing can be stranded if nothing was ever opened.
            const stranded =
              !opening.openFails &&
              close.refuseCloses > 0 &&
              report === "fault";

            // INVARIANT — never lose a listener: if the mechanism could not close
            // it and never said it was gone, it stays in the map.
            expect(listed.length).toBe(stranded ? 1 : 0);

            // INVARIANT — never publish a corpse: a `lost` forward is never
            // handed back, and neither is one that never opened.
            if (report === "lost" || opening.openFails) {
              expect(created.ok).toBe(false);
            }

            // A create that resolved must be a forward that is actually listed.
            if (created.ok) {
              expect(listed.map((f) => f.key)).toContain(created.f.key);
            }

            // And dispose must agree with the map: it fails if and only if
            // something is still there.
            if (disposed !== undefined) {
              expect(disposed.failed).toBe(stranded);
            }
          });
        }
      }
    }
  }
});

/** `cancel` crossed with the opening window.
 *
 *  Round nine found what the generator could not see: a cancel that begins
 *  while a forward is still opening, with a create arriving between the two.
 *  The create used to JOIN the doomed flight and be handed the very forward the
 *  cancel then closed — a caller holding something neither listed nor live. */
describe("cancel during the opening window", () => {
  const CLOSES = [
    { label: "close succeeds", refuseCloses: 0 },
    { label: "close refuses", refuseCloses: 1 },
  ] as const;
  const RECREATE = [false, true] as const;

  for (const close of CLOSES) {
    for (const recreating of RECREATE) {
      it(`cancel while opening · ${close.label} · ${recreating ? "a create arrives between them" : "no second create"}`, async () => {
        const rig = mapOf({
          deferOpen: true,
          refuseCloses: close.refuseCloses,
        });
        const { forwards } = rig;

        const first = forwards.create(PU).then(
          (f) => ({ ok: true as const, f }),
          (e: Error) => ({ ok: false as const, e }),
        );
        const cancelling = forwards.cancel("remote:pu-dev:5173").then(
          () => ({ failed: false }),
          () => ({ failed: true }),
        );
        const second = recreating
          ? forwards.create(PU).then(
              (f) => ({ ok: true as const, f }),
              (e: Error) => ({ ok: false as const, e }),
            )
          : undefined;
        rig.openArrives();

        const one = await first;
        const cancelled = await cancelling;
        const two = await second;
        const listed = forwards.list();

        expect(one.ok).toBe(true);
        // A refused close leaves it there; a successful one does not.
        expect(cancelled.failed).toBe(close.refuseCloses > 0);
        // What the map should hold afterwards: the forward a refused close
        // left behind, or the FRESH one a second create opened once the
        // teardown finished — and nothing at all when neither happened.
        expect(listed.length).toBe(
          close.refuseCloses > 0 || recreating ? 1 : 0,
        );

        if (two !== undefined) {
          // INVARIANT — a create never resolves with something that is not in
          // the map: it either opened a FRESH forward, or it got the one the
          // failed cancel left behind.
          expect(two.ok).toBe(true);
          if (two.ok) {
            expect(listed.map((f) => f.key)).toContain(two.f.key);
            if (close.refuseCloses === 0 && one.ok) {
              expect(two.f.localPort).not.toBe(one.f.localPort);
            }
          }
        }
      });
    }
  }
});

/** The CLOSING window, generated.
 *
 *  Round ten found the hole this closes: a report arriving while a teardown was
 *  in flight. A definitive loss deletes the slot (the loss is the stronger
 *  fact), but the close's own rejection was still returned as the outcome — so
 *  `dispose` claimed a forward could not be torn down while its map was empty.
 *
 *  The rule this pins: **the outcome is the map**. A teardown reports failure if
 *  and only if the forward is still listed afterwards. */
describe("a report arriving mid-teardown", () => {
  const REPORTS = ["none", "lost", "fault"] as const;
  const CLOSES = [
    { label: "close succeeds", fail: false },
    { label: "close refuses", fail: true },
  ] as const;
  const VIA = ["cancel", "dispose"] as const;
  /** One caller, or TWO of the same kind at once — two cancels racing each
   *  other, two disposals racing each other. They are supposed to JOIN the one
   *  teardown through `closeSlot`; that was verified by inspection, which is
   *  not the same as pinned, so it is generated here. */
  const CALLERS = [1, 2] as const;

  for (const via of VIA) {
    for (const callers of CALLERS) {
      for (const report of REPORTS) {
        for (const close of CLOSES) {
          it(`${callers === 1 ? via : `${via} × 2 at once`} · ${report} arrives while closing · ${close.label}`, async () => {
            let channel: ForwardReport | undefined;
            const rig = mapOf({
              onOpen: (r) => (channel = r),
              deferClose: true,
            });
            const { forwards } = rig;
            const forward = await forwards.create(PU);

            const fire = () =>
              (via === "cancel"
                ? forwards.cancel(forward.key)
                : forwards.dispose()
              ).then(
                () => ({ failed: false }),
                () => ({ failed: true }),
              );
            const teardowns = Array.from({ length: callers }, fire);
            await Promise.resolve();
            if (report === "lost") channel?.lost("gone mid-teardown");
            if (report === "fault") channel?.fault("broke mid-teardown");
            rig.closeSettles(
              close.fail ? new Error("close refused") : undefined,
            );

            const outcomes = await Promise.all(teardowns);
            const listed = forwards.list();

            // THE RULE: the reported outcome and the map agree, always.
            for (const outcome of outcomes) {
              expect(outcome.failed).toBe(listed.length > 0);
            }
            // Same-kind callers JOIN one teardown rather than each running their
            // own, so they cannot disagree and the mechanism is asked once.
            expect(new Set(outcomes.map((o) => o.failed)).size).toBe(1);
            expect(rig.closeCount()).toBe(1);

            // A definitive loss is the stronger fact: it is gone even if the
            // close then failed.
            if (report === "lost") expect(listed).toEqual([]);
            // Otherwise a refused close leaves it listed and retryable.
            if (report !== "lost" && close.fail) expect(listed).toHaveLength(1);
          });
        }
      }
    }
  }
});

describe("never publish a corpse", () => {
  it("a loss during the open is never handed back", async () => {
    const { forwards } = mapOf({
      onOpen: (r) => r.lost("died before it was up"),
    });

    await expect(forwards.create(PU)).rejects.toThrow(/lost as it came up/);
    expect(forwards.list()).toEqual([]);
  });

  it("a loss during a cancel is not undone by a failing close", async () => {
    let report: ForwardReport | undefined;
    const { forwards, closeSettles } = mapOf({
      onOpen: (r) => (report = r),
      deferClose: true,
    });
    const forward = await forwards.create(PU);

    const cancelling = forwards.cancel(forward.key).catch((e: Error) => e);
    await Promise.resolve();
    report?.lost("the connection ended");
    closeSettles(new Error("close refused"));
    await cancelling;

    // The mechanism said it was gone; a failed close must not resurrect it.
    expect(forwards.list()).toEqual([]);
  });

  it("a closing forward is never handed to a create", async () => {
    const { forwards, closeSettles } = mapOf({ deferClose: true });
    const first = await forwards.create(PU);

    const cancelling = forwards.cancel(first.key);
    await Promise.resolve();
    const recreating = forwards.create(PU);
    expect(forwards.list()).toEqual([]);

    closeSettles();
    await cancelling;
    const second = await recreating;

    expect(second.localPort).not.toBe(first.localPort);
  });
});

describe("one teardown per forward", () => {
  it("a dispose joining a cancel closes once and sees its failure", async () => {
    const { forwards, closeSettles, closeCount } = mapOf({ deferClose: true });
    const forward = await forwards.create(PU);

    const cancelling = forwards.cancel(forward.key).catch((e: Error) => e);
    await Promise.resolve();
    const disposing = forwards.dispose().catch((e: unknown) => e);
    closeSettles(new Error("close refused"));

    expect(await cancelling).toBeInstanceOf(Error);
    expect(await disposing).toBeInstanceOf(AggregateError);
    expect(closeCount()).toBe(1);
  });

  it("a dispose that races an opening closes it once", async () => {
    const { forwards, openArrives, closeCount } = mapOf({
      deferOpen: true,
      refuseCloses: 1,
    });

    const creating = forwards.create(PU).catch((e: Error) => e);
    const disposing = forwards.dispose().catch((e: unknown) => e);
    openArrives();

    expect(await creating).toBeInstanceOf(Error);
    expect(await disposing).toBeInstanceOf(AggregateError);
    expect(closeCount()).toBe(1);
  });
});
