/**
 * kolu's forward POLICY — the rules that live above `@kolu/port-forward`'s map.
 *
 * Every case here is about a decision the library deliberately has no opinion
 * about: why a forward exists, what evidence may close it, and what "the host
 * left" does to it. The map itself (idempotence, races, loss, teardown) is tested
 * in the library beside its own code, so nothing here re-tests it — the fake
 * mechanism below is the shortest thing that can stand in for a door.
 */

import type {
  ForwardLoss,
  ForwardManager,
  ForwardMechanisms,
} from "@kolu/port-forward";
import { makeForwardManager } from "@kolu/port-forward";
import type { HostKey } from "kolu-common/hostKey";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKoluForwards, type HostPorts } from "./forwards.ts";

const log = pino({ level: "silent" });

const LOCAL: HostKey = { kind: "local" };
const PU: HostKey = { kind: "remote", target: "pu-dev" };
const ZEST: HostKey = { kind: "remote", target: "zest" };

/** A door that opens instantly. The local port is the remote one, so a test can
 *  say which forward it means without threading a counter through. */
function fakeMechanisms(): {
  mechanisms: ForwardMechanisms;
  closed: number[];
  /** Refuse to close — the "a listener we cannot take down" case. */
  refuseClose: (yes: boolean) => void;
} {
  const closed: number[] = [];
  let refuse = false;
  return {
    closed,
    refuseClose: (yes) => {
      refuse = yes;
    },
    mechanisms: {
      async open(target) {
        return {
          localPort: target.port,
          close: async () => {
            if (refuse) throw new Error("the listener would not close");
            closed.push(target.port);
          },
        };
      },
    },
  };
}

function harness(
  ports: Map<string, HostPorts> = new Map(),
  opts: { onMechanisms?: ReturnType<typeof fakeMechanisms> } = {},
) {
  const fake = opts.onMechanisms ?? fakeMechanisms();
  const published: Array<ReturnType<typeof forwards.list>> = [];
  const readHostPorts = vi.fn(
    async (host: HostKey): Promise<HostPorts> =>
      ports.get(host.kind === "local" ? "local" : host.target) ?? "unknown",
  );
  const forwards = createKoluForwards({
    readHostPorts,
    log,
    onChange: (list) => published.push(list),
    makeManager: (o: { onLost: (loss: ForwardLoss) => void }): ForwardManager =>
      makeForwardManager({ mechanisms: fake.mechanisms, onLost: o.onLost }),
  });
  return { forwards, published, readHostPorts, fake, ports };
}

describe("origins", () => {
  it("records why each forward exists", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 8080, origin: "manual" });

    expect(h.forwards.list().map((f) => [f.remotePort, f.origin])).toEqual([
      [5173, "auto"],
      [8080, "manual"],
    ]);
  });

  it("carries the kolu host key, so a row can be filtered to a host", async () => {
    const h = harness();
    await h.forwards.create({ host: LOCAL, port: 3000, origin: "auto" });
    await h.forwards.create({ host: ZEST, port: 3000, origin: "auto" });

    expect(h.forwards.list().map((f) => f.host)).toEqual([
      { kind: "local" },
      { kind: "remote", target: "zest" },
    ]);
  });

  it("PROMOTES an auto forward when it is asked for by hand", async () => {
    // The user has now named this target, so it stops being kolu's to reap: a
    // scanner that later loses sight of the port must not close a door someone
    // deliberately set up.
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    expect(h.forwards.list()).toHaveLength(1);
    expect(h.forwards.list()[0]?.origin).toBe("manual");
  });

  it("never DEMOTES a manual forward to auto", async () => {
    // The reverse of the case above, and the direction that would lose work: a
    // chip click on a port that already has a hand-made forward must not hand
    // kolu permission to close it.
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    expect(h.forwards.list()[0]?.origin).toBe("manual");
  });
});

describe("the auto-cancel rule", () => {
  it("closes an auto forward once the scanner says its port is gone", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", new Set([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    // Still listening: nothing happens.
    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toHaveLength(1);

    // The dev server died. The scan is a real observation that does not contain
    // the port, which is the only thing that may close the door.
    ports.set("pu-dev", new Set([9229]));
    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toEqual([]);
    expect(h.fake.closed).toEqual([5173]);
  });

  it("leaves a MANUAL forward standing when its port disappears", async () => {
    // A manual forward may point at something no scanner can see — a port
    // outside every terminal's subtree, a service started before kolu — so
    // "the scan does not list it" is its NORMAL state, not evidence of death.
    const ports = new Map<string, HostPorts>([["pu-dev", new Set<number>()]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("leaves an auto forward standing when the host could not be read", async () => {
    // The rule the whole `known`/`unknown` two-way exists for. "We could not
    // look" is not "nothing is listening"; treating it as one would tear down a
    // working forward every time a host hiccuped.
    const ports = new Map<string, HostPorts>([["pu-dev", "unknown"]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("leaves an auto forward standing when the read THREW", async () => {
    // Same rule through the other door: a failed read is not evidence either,
    // and a caught error here must not collapse into an empty port set.
    const h = harness();
    h.readHostPorts.mockRejectedValue(new Error("the mirror is down"));
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("reads a host EMPTY as a real answer, so a last port really dies", async () => {
    // The other side of the coin: a scanned host that serves nothing is an
    // observation, so the final auto forward on it must close. Without this the
    // `unknown` rule above would quietly mean forwards never die at all.
    const ports = new Map<string, HostPorts>([["pu-dev", new Set<number>()]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toEqual([]);
  });

  it("reads each host once, and only the hosts that have auto forwards", async () => {
    // Cost tracks the feature's USE, not the size of the fleet: a kolu whose
    // user has never clicked a port chip reads nothing at all.
    const ports = new Map<string, HostPorts>([
      ["pu-dev", new Set([5173, 8080])],
    ]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 8080, origin: "auto" });
    await h.forwards.create({ host: ZEST, port: 3000, origin: "manual" });

    h.readHostPorts.mockClear();
    await h.forwards.reapDeadAuto();
    expect(h.readHostPorts.mock.calls.map(([host]) => host)).toEqual([PU]);
  });

  it("reads nothing at all when there are no auto forwards", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    h.readHostPorts.mockClear();
    await h.forwards.reapDeadAuto();
    expect(h.readHostPorts).not.toHaveBeenCalled();
  });

  it("keeps a dead forward LISTED when its door refuses to close", async () => {
    // A listener kolu could not shut is still out there. Dropping the row would
    // leave a door open with nothing left pointing at it; keeping it means the
    // next pass — or the user — can retry.
    const fake = fakeMechanisms();
    const ports = new Map<string, HostPorts>([["pu-dev", new Set<number>()]]);
    const h = harness(ports, { onMechanisms: fake });
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    fake.refuseClose(true);
    await expect(h.forwards.reapDeadAuto()).resolves.toBeUndefined();
    expect(h.forwards.list()).toHaveLength(1);

    fake.refuseClose(false);
    await h.forwards.reapDeadAuto();
    expect(h.forwards.list()).toEqual([]);
  });
});

describe("a host leaving", () => {
  it("takes ITS forwards down, both origins", async () => {
    // A door to a machine kolu no longer has is a door to nowhere — the one
    // thing besides an explicit cancel that closes a manual forward.
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 8080, origin: "manual" });
    await h.forwards.create({ host: ZEST, port: 3000, origin: "manual" });

    await h.forwards.hostDeparted(PU);
    expect(h.forwards.list().map((f) => f.host)).toEqual([
      { kind: "remote", target: "zest" },
    ]);
  });

  it("touches nothing when the departed host had none", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    const before = h.published.length;
    await h.forwards.hostDeparted(ZEST);
    expect(h.forwards.list()).toHaveLength(1);
    // …and publishes nothing, so an unrelated host's departure cannot tick every
    // reader of the list.
    expect(h.published).toHaveLength(before);
  });
});

describe("what the cell sees", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness(new Map([["pu-dev", new Set<number>()]]));
  });

  it("publishes on create and on cancel", async () => {
    const forward = await h.forwards.create({
      host: PU,
      port: 5173,
      origin: "auto",
    });
    expect(h.published.at(-1)).toHaveLength(1);

    await h.forwards.cancel(forward.key);
    expect(h.published.at(-1)).toEqual([]);
  });

  it("publishes when a forward dies on its own", async () => {
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.reapDeadAuto();
    expect(h.published.at(-1)).toEqual([]);
  });

  it("rejects a cancel for a key it does not hold", async () => {
    // Nothing is "already fine" about cancelling a forward that was never there:
    // it means the caller's view of the list disagrees with the map.
    await expect(h.forwards.cancel("remote:pu-dev:5173")).rejects.toThrow();
  });

  it("empties the list on dispose", async () => {
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.dispose();
    expect(h.forwards.list()).toEqual([]);
    expect(h.published.at(-1)).toEqual([]);
  });
});
