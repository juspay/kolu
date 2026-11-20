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

function scripted(script: {
  onOpen?: (report: ForwardReport) => void;
  deferOpen?: boolean;
  refuseCloses?: number;
  deferClose?: boolean;
  openFails?: boolean;
}) {
  let releaseOpen: (() => void) | undefined;
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
            const stranded =
              !opening.openFails &&
              close.refuseCloses > 0 &&
              report === "fault";

            expect(listed.length).toBe(stranded ? 1 : 0);

            if (report === "lost" || opening.openFails) {
              expect(created.ok).toBe(false);
            }

            if (created.ok) {
              expect(listed.map((f) => f.key)).toContain(created.f.key);
            }

            if (disposed !== undefined) {
              expect(disposed.failed).toBe(stranded);
            }
          });
        }
      }
    }
  }
});

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
        expect(cancelled.failed).toBe(close.refuseCloses > 0);
        expect(listed.length).toBe(
          close.refuseCloses > 0 || recreating ? 1 : 0,
        );

        if (two !== undefined) {
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

describe("a report arriving mid-teardown", () => {
  const REPORTS = ["none", "lost", "fault"] as const;
  const CLOSES = [
    { label: "close succeeds", fail: false },
    { label: "close refuses", fail: true },
  ] as const;
  const VIA = ["cancel", "dispose"] as const;
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

            for (const outcome of outcomes) {
              expect(outcome.failed).toBe(listed.length > 0);
            }
            expect(new Set(outcomes.map((o) => o.failed)).size).toBe(1);
            expect(rig.closeCount()).toBe(1);

            if (report === "lost") expect(listed).toEqual([]);
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
