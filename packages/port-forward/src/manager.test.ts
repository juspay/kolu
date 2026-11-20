import { describe, expect, it, vi } from "vitest";
import type { ForwardLoss } from "./manager.ts";
import { makeForwardManager } from "./manager.ts";
import type { ForwardMechanisms } from "./mechanism.ts";
import { type ForwardTarget, targetKey } from "./target.ts";

function fakeMechanisms(): {
  mechanisms: ForwardMechanisms;
  opens: ForwardTarget[];
  closes: number[];
  killFromOutside: (key: string, reason: string) => void;
  killFirstOpening: (reason: string) => void;
  remembered: Array<number | undefined>;
} {
  const opens: ForwardTarget[] = [];
  const closes: number[] = [];
  const remembered: Array<number | undefined> = [];
  const losers = new Map<string, (reason: string) => void>();
  const everyOpening: Array<(reason: string) => void> = [];
  let nextPort = 61000;
  return {
    opens,
    closes,
    remembered,
    killFirstOpening: (reason) => {
      const notify = everyOpening[0];
      if (notify === undefined) throw new Error("nothing was ever opened");
      notify(reason);
    },
    killFromOutside: (key, reason) => {
      const notify = losers.get(key);
      if (notify === undefined) throw new Error(`nothing open for ${key}`);
      notify(reason);
    },
    mechanisms: {
      async open({ target, report, lastLocalPort }) {
        opens.push(target);
        remembered.push(lastLocalPort);
        const localPort = lastLocalPort ?? nextPort++;
        losers.set(targetKey(target), report.lost);
        everyOpening.push(report.lost);
        return {
          localPort,
          close: async () => {
            closes.push(localPort);
          },
        };
      },
    },
  };
}

const PU: ForwardTarget = {
  kind: "remote",
  host: "pu-dev",
  port: 5173,
  loopback: "v4",
};
const ZEST: ForwardTarget = {
  kind: "remote",
  host: "zest",
  port: 8080,
  loopback: "v4",
};

describe("the forward map", () => {
  it("opens one listener per target and lists it", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const forward = await forwards.create(PU);
    expect(forward.key).toBe("remote:pu-dev:5173");
    expect(forward.localPort).toBe(61000);
    expect(forwards.list()).toEqual([forward]);
  });

  it("holds N hosts × N ports at once", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    await forwards.create(PU);
    await forwards.create({
      kind: "remote",
      host: "pu-dev",
      port: 9229,
      loopback: "v4",
    });
    await forwards.create(ZEST);
    await forwards.create({ kind: "local", port: 5173, loopback: "v4" });

    expect(forwards.list().map((f) => f.key)).toEqual([
      "remote:pu-dev:5173",
      "remote:pu-dev:9229",
      "remote:zest:8080",
      "local:5173",
    ]);
  });

  it("is idempotent per target — a second create returns the same forward", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const first = await forwards.create(PU);
    const second = await forwards.create({ ...PU });

    expect(second).toBe(first);
    expect(fake.opens).toHaveLength(1);
  });

  it("collapses concurrent creates for one target into one listener", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const [a, b] = await Promise.all([
      forwards.create(PU),
      forwards.create(PU),
    ]);

    expect(a).toBe(b);
    expect(fake.opens).toHaveLength(1);
  });

  it("cancels by key and takes the listener down", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const forward = await forwards.create(PU);
    await forwards.cancel(forward.key);

    expect(fake.closes).toEqual([forward.localPort]);
    expect(forwards.list()).toEqual([]);
  });

  it("refuses to cancel a key it never had", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    await expect(forwards.cancel("ghost:1")).rejects.toThrow(/no forward/);
  });

  it("refuses a target it cannot forward, before it reaches a mechanism", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    await expect(
      forwards.create({ kind: "local", port: 0, loopback: "v4" }),
    ).rejects.toThrow(/between 1 and 65535/);
    await expect(
      forwards.create({
        kind: "remote",
        host: "-oProxyCommand=x",
        port: 22,
        loopback: "v4",
      }),
    ).rejects.toThrow(/starts with "-"/);
    expect(fake.opens).toEqual([]);
    expect(forwards.list()).toEqual([]);
  });

  it("cancels a forward that is still opening", async () => {
    let arrive: (() => void) | undefined;
    const closed: number[] = [];
    const slow: ForwardMechanisms = {
      open: async () => {
        await new Promise<void>((resolve) => {
          arrive = resolve;
        });
        return {
          localPort: 4123,
          close: async () => {
            closed.push(4123);
          },
        };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: slow,
      onLost: () => {},
    });

    const creating = forwards.create(PU);
    const cancelling = forwards.cancel(targetKey(PU));
    arrive?.();

    await creating;
    await cancelling;
    expect(closed).toEqual([4123]);
    expect(forwards.list()).toEqual([]);
  });

  it("lets a create be retried after a failure, leaving nothing behind", async () => {
    const failing: ForwardMechanisms = {
      open: async () => {
        throw new Error("ssh exited 255: Host key verification failed");
      },
    };
    const forwards = makeForwardManager({
      mechanisms: failing,
      onLost: () => {},
    });

    await expect(forwards.create(PU)).rejects.toThrow(/Host key/);
    expect(forwards.list()).toEqual([]);
    await expect(forwards.create(PU)).rejects.toThrow(/Host key/);
  });

  it("drops a forward that dies on its own and says why", async () => {
    const fake = fakeMechanisms();
    const onLost = vi.fn<(loss: ForwardLoss) => void>();
    const forwards = makeForwardManager({ ...fake, onLost });

    const forward = await forwards.create(PU);
    fake.killFromOutside(forward.key, "the ssh connection to pu-dev ended");

    expect(forwards.list()).toEqual([]);
    expect(onLost).toHaveBeenCalledWith({
      forward,
      reason: "the ssh connection to pu-dev ended",
      kind: "gone",
    });
  });

  it("re-creates a forward whose target died", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const first = await forwards.create(PU);
    fake.killFromOutside(first.key, "host dropped");
    const second = await forwards.create(PU);

    expect(fake.opens).toEqual([PU, PU]);
    expect(second).not.toBe(first);
    expect(forwards.list()).toEqual([second]);
  });

  it("tears every forward down on dispose", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    await forwards.create(PU);
    await forwards.create(ZEST);
    await forwards.dispose();

    expect(fake.closes).toEqual([61000, 61001]);
    expect(forwards.list()).toEqual([]);
  });

  it("closes a forward that was still opening when dispose ran", async () => {
    let arrive: (() => void) | undefined;
    const closed: number[] = [];
    const slow: ForwardMechanisms = {
      open: async () => {
        await new Promise<void>((resolve) => {
          arrive = resolve;
        });
        return {
          localPort: 4123,
          close: async () => {
            closed.push(4123);
          },
        };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: slow,
      onLost: () => {},
    });

    const creating = forwards.create(PU);
    const disposing = forwards.dispose();
    arrive?.();

    await expect(creating).rejects.toThrow(/disposed/);
    await disposing;
    expect(closed).toEqual([4123]);
    expect(forwards.list()).toEqual([]);
  });

  it("reports a teardown that failed while the forward was still opening", async () => {
    let arrive: (() => void) | undefined;
    const stubborn: ForwardMechanisms = {
      open: async () => {
        await new Promise<void>((resolve) => {
          arrive = resolve;
        });
        return {
          localPort: 4123,
          close: async () => {
            throw new Error("the listener refused to close");
          },
        };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: stubborn,
      onLost: () => {},
    });

    const creating = forwards.create(PU);
    const disposing = forwards.dispose();
    arrive?.();

    await expect(creating).rejects.toThrow(/refused to close/);
    await expect(disposing).rejects.toThrow(AggregateError);
    expect(forwards.list().map((f) => f.key)).toEqual(["remote:pu-dev:5173"]);
  });

  it("never hands a create the forward that is closing under it", async () => {
    let release: (() => void) | undefined;
    let opens = 0;
    const slow: ForwardMechanisms = {
      open: async () => {
        const localPort = 4123 + opens++;
        return {
          localPort,
          close: () =>
            new Promise<void>((done) => {
              release = done;
            }),
        };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: slow,
      onLost: () => {},
    });
    const first = await forwards.create(PU);

    const cancelling = forwards.cancel(first.key);
    await Promise.resolve();
    const recreating = forwards.create(PU);
    expect(forwards.list()).toEqual([]);

    release?.();
    await cancelling;
    const second = await recreating;

    expect(second.localPort).not.toBe(first.localPort);
    expect(forwards.list()).toEqual([second]);
  });

  it("a late loss cannot delete the REPLACEMENT that reused its key", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });
    const first = await forwards.create(PU);
    await forwards.cancel(first.key);
    const second = await forwards.create(PU);

    fake.killFirstOpening("host dropped, belatedly");

    expect(forwards.list()).toEqual([second]);
  });

  it("works when its methods are pulled off the object", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });
    const { create, cancel } = forwards;

    const forward = await create(PU);
    await cancel(forward.key);
    const again = await create(PU);

    expect(fake.opens).toEqual([PU, PU]);
    expect(again).not.toBe(forward);
  });

  it("attempts one teardown per forward in a dispose, even when the first fails", async () => {
    let closes = 0;
    let arrive: (() => void) | undefined;
    const once: ForwardMechanisms = {
      open: async () => {
        await new Promise<void>((resolve) => {
          arrive = resolve;
        });
        return {
          localPort: 4123,
          close: async () => {
            closes += 1;
            throw new Error("close refused");
          },
        };
      },
    };
    const forwards = makeForwardManager({ mechanisms: once, onLost: () => {} });

    const creating = forwards.create(PU);
    const disposing = forwards.dispose();
    arrive?.();

    await expect(creating).rejects.toThrow(/close refused/);
    const err = await disposing.catch((e: AggregateError) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).errors).toHaveLength(1);
    expect(closes).toBe(1);
    expect(forwards.list()).toHaveLength(1);
  });

  it("lets a joining dispose see the failure of the close it joined", async () => {
    let release: ((err?: Error) => void) | undefined;
    const slow: ForwardMechanisms = {
      open: async () => ({
        localPort: 4123,
        close: () =>
          new Promise<void>((done, fail) => {
            release = (err) => (err === undefined ? done() : fail(err));
          }),
      }),
    };
    const forwards = makeForwardManager({ mechanisms: slow, onLost: () => {} });
    const forward = await forwards.create(PU);

    const cancelling = forwards.cancel(forward.key).catch((e: Error) => e);
    await Promise.resolve();
    const disposing = forwards.dispose().catch((e: unknown) => e);
    release?.(new Error("close refused"));

    expect(await cancelling).toBeInstanceOf(Error);
    expect(await disposing).toBeInstanceOf(AggregateError);
  });

  it("does not publish a forward the mechanism killed before it arrived", async () => {
    const early: ForwardMechanisms = {
      open: async ({ report }) => {
        report.lost("the ssh connection ended before it was up");
        return { localPort: 4123, close: async () => {} };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: early,
      onLost: () => {},
    });

    await expect(forwards.create(PU)).rejects.toThrow(/lost as it came up/);
    expect(forwards.list()).toEqual([]);
  });

  it("does not restore a listener the mechanism already called dead", async () => {
    let arrive: (() => void) | undefined;
    const doomed: ForwardMechanisms = {
      open: async ({ report }) => {
        report.lost("the ssh connection ended before it was up");
        await new Promise<void>((resolve) => {
          arrive = resolve;
        });
        return {
          localPort: 4123,
          close: async () => {
            throw new Error("close refused");
          },
        };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: doomed,
      onLost: () => {},
    });

    const creating = forwards.create(PU);
    const disposing = forwards.dispose();
    arrive?.();

    await expect(creating).rejects.toThrow(/disposed while this forward/);
    await disposing;
    expect(forwards.list()).toEqual([]);
  });

  it("keeps a forward whose listener broke but could not be closed", async () => {
    const reports: ForwardLoss[] = [];
    let fault: ((reason: string) => void) | undefined;
    const flaky: ForwardMechanisms = {
      open: async ({ report }) => {
        fault = report.fault;
        return { localPort: 4123, close: async () => {} };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: flaky,
      onLost: (loss) => reports.push(loss),
    });
    const forward = await forwards.create(PU);

    fault?.("the listener failed, and closing it failed too");

    expect(reports).toHaveLength(1);
    expect(reports[0]?.kind).toBe("degraded");
    expect(forwards.list()).toEqual([forward]);
  });

  it("opens nothing more once disposed", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });
    await forwards.dispose();

    await expect(forwards.create(PU)).rejects.toThrow(/disposed/);
    expect(fake.opens).toEqual([]);
  });

  it("keeps a forward whose teardown was REFUSED, and still tears down the rest", async () => {
    const closed: number[] = [];
    let port = 100;
    const flaky: ForwardMechanisms = {
      open: async ({ target }) => {
        const localPort = port++;
        return {
          localPort,
          close: async () => {
            if (target.kind === "remote" && target.host === "zest") {
              throw new Error("ssh exited 255");
            }
            closed.push(localPort);
          },
        };
      },
    };
    const forwards = makeForwardManager({
      mechanisms: flaky,
      onLost: () => {},
    });
    await forwards.create(PU);
    await forwards.create(ZEST);
    await forwards.create({ kind: "local", port: 3000, loopback: "v4" });

    await expect(forwards.dispose()).rejects.toThrow(AggregateError);
    expect(closed).toEqual([100, 102]);
    expect(forwards.list().map((f) => f.key)).toEqual(["remote:zest:8080"]);
  });

  it("lets a refused cancel be retried once the mechanism recovers", async () => {
    let refuse = true;
    const stubborn: ForwardMechanisms = {
      open: async () => ({
        localPort: 4123,
        close: async () => {
          if (refuse) throw new Error("ssh exited 255");
        },
      }),
    };
    const forwards = makeForwardManager({
      mechanisms: stubborn,
      onLost: () => {},
    });
    const forward = await forwards.create(PU);

    await expect(forwards.cancel(forward.key)).rejects.toThrow(/255/);
    expect(forwards.list()).toEqual([forward]);

    refuse = false;
    await forwards.cancel(forward.key);
    expect(forwards.list()).toEqual([]);
  });
});

describe("the local port a target comes back on", () => {
  it("is remembered across a cancel, so a restarted server keeps its URL", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const first = await forwards.create(PU);
    await forwards.cancel(first.key);
    const again = await forwards.create(PU);

    expect(fake.remembered).toEqual([undefined, first.localPort]);
    expect(again.localPort).toBe(first.localPort);
  });

  it("is remembered across a LOSS, which runs no teardown of ours", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const first = await forwards.create(PU);
    fake.killFromOutside(first.key, "the connection dropped");
    expect(forwards.list()).toEqual([]);

    const again = await forwards.create(PU);
    expect(again.localPort).toBe(first.localPort);
  });

  it("is per TARGET, never shared between two of them", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const pu = await forwards.create(PU);
    const zest = await forwards.create(ZEST);
    expect(fake.remembered).toEqual([undefined, undefined]);
    expect(zest.localPort).not.toBe(pu.localPort);
  });
});
