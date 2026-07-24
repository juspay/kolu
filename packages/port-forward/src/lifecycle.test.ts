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

const PU: ForwardTarget = { kind: "remote", host: "pu-dev", port: 5173 };

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
}) {
  let releaseOpen: (() => void) | undefined;
  let releaseClose: ((fail?: Error) => void) | undefined;
  let refusals = script.refuseCloses ?? 0;
  let closes = 0;
  const mechanisms: ForwardMechanisms = {
    open: async (_target, report) => {
      script.onOpen?.(report);
      if (script.deferOpen === true) {
        await new Promise<void>((resolve) => {
          releaseOpen = resolve;
        });
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
    openArrives: () => releaseOpen?.(),
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
