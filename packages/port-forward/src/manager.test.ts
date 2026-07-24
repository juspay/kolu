import { describe, expect, it, vi } from "vitest";
import { makeForwardManager } from "./manager.ts";
import type { ForwardLoss } from "./manager.ts";
import type { ForwardMechanisms } from "./opened.ts";
import type { ForwardTarget } from "./target.ts";

/** A mechanism that opens instantly and records what it was asked for, so the
 *  map's own semantics are what's under test. */
function fakeMechanisms(): {
  mechanisms: ForwardMechanisms;
  opens: ForwardTarget[];
  closes: number[];
  /** Kill the forward opened for `key` the way a dropped ssh master would. */
  killFromOutside: (key: string, reason: string) => void;
} {
  const opens: ForwardTarget[] = [];
  const closes: number[] = [];
  const losers = new Map<string, (reason: string) => void>();
  let nextPort = 61000;
  return {
    opens,
    closes,
    killFromOutside: (key, reason) => {
      const notify = losers.get(key);
      if (notify === undefined) throw new Error(`nothing open for ${key}`);
      notify(reason);
    },
    mechanisms: {
      async open(target, onLost) {
        opens.push(target);
        const localPort = nextPort++;
        losers.set(
          target.kind === "local"
            ? `local:${target.port}`
            : `${target.host}:${target.port}`,
          onLost,
        );
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

const PU: ForwardTarget = { kind: "remote", host: "pu-dev", port: 5173 };
const ZEST: ForwardTarget = { kind: "remote", host: "zest", port: 8080 };

describe("the forward map", () => {
  it("opens one listener per target and lists it", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const forward = await forwards.create(PU);
    expect(forward.key).toBe("pu-dev:5173");
    expect(forward.localPort).toBe(61000);
    expect(forwards.list()).toEqual([forward]);
  });

  it("holds N hosts × N ports at once", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    await forwards.create(PU);
    await forwards.create({ kind: "remote", host: "pu-dev", port: 9229 });
    await forwards.create(ZEST);
    await forwards.create({ kind: "local", port: 5173 });

    expect(forwards.list().map((f) => f.key)).toEqual([
      "pu-dev:5173",
      "pu-dev:9229",
      "zest:8080",
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
    // The map is the door every consumer knocks on, so it — not whichever
    // mechanism happens to be plugged in — is what rejects an impossible
    // target, and nothing is registered for it.
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    await expect(forwards.create({ kind: "local", port: 0 })).rejects.toThrow(
      /between 1 and 65535/,
    );
    await expect(
      forwards.create({ kind: "remote", host: "-oProxyCommand=x", port: 22 }),
    ).rejects.toThrow(/starts with "-"/);
    expect(fake.opens).toEqual([]);
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
    // The failed flight must not be cached as in-flight forever.
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
    });
  });

  it("re-creates a forward whose target died", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });

    const first = await forwards.create(PU);
    fake.killFromOutside(first.key, "host dropped");
    const second = await forwards.create(PU);

    expect(second.localPort).not.toBe(first.localPort);
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
    // Quitting while an add is in flight: the listener comes up AFTER dispose
    // was called, so nothing in the map ever sees it. It must still go down —
    // otherwise "quit tears everything down" is false exactly when the user is
    // least able to notice.
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

  it("opens nothing more once disposed", async () => {
    const fake = fakeMechanisms();
    const forwards = makeForwardManager({ ...fake, onLost: () => {} });
    await forwards.dispose();

    await expect(forwards.create(PU)).rejects.toThrow(/disposed/);
    expect(fake.opens).toEqual([]);
  });

  it("still attempts every teardown when one fails, then reports the failures", async () => {
    const closed: number[] = [];
    let port = 100;
    const flaky: ForwardMechanisms = {
      open: async (target) => {
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
    await forwards.create({ kind: "local", port: 3000 });

    await expect(forwards.dispose()).rejects.toThrow(AggregateError);
    expect(closed).toEqual([100, 102]);
    expect(forwards.list()).toEqual([]);
  });
});
