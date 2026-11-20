import type {
  ForwardLoss,
  ForwardManager,
  ForwardMechanisms,
  ForwardReport,
} from "@kolu/port-forward";
import { makeForwardManager } from "@kolu/port-forward";
import type { HostKey } from "kolu-common/hostKey";
import type { ForwardOrigin, Forwards } from "kolu-common/surface";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCellConverges } from "@kolu/surface/assert-cell-converges";
import { everyMsOr, source } from "@kolu/surface/reactor";
import { createKoluForwards } from "./forwards.ts";
import {
  type HostPorts,
  OPENING_CLICK_READ_BUDGET_MS,
  REAP_READ_BUDGET_MS,
} from "./hostPorts.ts";

function captureLog(): {
  log: pino.Logger;
  lines: Array<Record<string, unknown>>;
} {
  const lines: Array<Record<string, unknown>> = [];
  const log = pino(
    { level: "trace" },
    {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as Record<string, unknown>);
      },
    },
  );
  return { log, lines };
}

const listening = (ports: number[]): HostPorts => ({
  status: "observed",
  ports: new Map(ports.map((port) => [port, "v4" as const])),
});

const LOCAL: HostKey = { kind: "local" };
const PU: HostKey = { kind: "remote", target: "pu-dev" };
const ZEST: HostKey = { kind: "remote", target: "zest" };

function fakeMechanisms(): {
  mechanisms: ForwardMechanisms;
  closed: number[];
  refuseClose: (yes: boolean) => void;
  reportFor: (port: number) => ForwardReport;
} {
  const closed: number[] = [];
  const reports = new Map<number, ForwardReport>();
  let refuse = false;
  return {
    closed,
    refuseClose: (yes) => {
      refuse = yes;
    },
    reportFor: (port) => {
      const report = reports.get(port);
      if (report === undefined) {
        throw new Error(`no door was ever opened for port ${port}`);
      }
      return report;
    },
    mechanisms: {
      async open({ target, report }) {
        reports.set(target.port, report);
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
  const { log, lines } = captureLog();
  const published: Array<ReturnType<typeof forwards.list>> = [];
  const answer = async (host: HostKey): Promise<HostPorts> =>
    ports.get(host.kind === "local" ? "local" : host.target) ?? {
      status: "unobserved",
    };
  const readHostPorts = {
    forReap: vi.fn(answer),
    forOpeningClick: vi.fn(answer),
  };
  const h = {
    onChange: (list: Forwards) => {
      published.push(list);
    },
  };
  const member = { all: true };
  const forwards = createKoluForwards({
    readHostPorts,
    hostIsMember: () => member.all,
    log,
    makeManager: (o: {
      onLost: (loss: ForwardLoss<ForwardOrigin>) => void;
    }): ForwardManager<ForwardOrigin> =>
      makeForwardManager<ForwardOrigin>({
        mechanisms: fake.mechanisms,
        onLost: o.onLost,
      }),
  });
  forwards.subscribe(() => h.onChange(forwards.list()));
  return {
    forwards,
    published,
    readHostPorts,
    fake,
    ports,
    lines,
    depart: () => {
      member.all = false;
    },
    set onChange(fn: (list: Forwards) => void) {
      h.onChange = fn;
    },
  };
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
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    expect(h.forwards.list()).toHaveLength(1);
    expect(h.forwards.list()[0]?.origin).toBe("manual");
  });

  it("never DEMOTES a manual forward to auto", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    expect(h.forwards.list()[0]?.origin).toBe("manual");
  });
});

describe("the auto-cancel rule", () => {
  it("closes an auto forward once the scanner says its port is gone", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);

    ports.set("pu-dev", listening([9229]));
    await h.forwards.reconcile();
    expect(h.forwards.list()).toEqual([]);
    expect(h.fake.closed).toEqual([5173]);
  });

  it("leaves a MANUAL forward standing when its port disappears", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("leaves an auto forward standing when the host could not be read", async () => {
    const ports = new Map<string, HostPorts>([
      ["pu-dev", { status: "unobserved" }],
    ]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("leaves an auto forward standing when the read THREW", async () => {
    const h = harness();
    h.readHostPorts.forReap.mockRejectedValue(new Error("the mirror is down"));
    h.readHostPorts.forOpeningClick.mockRejectedValue(
      new Error("the mirror is down"),
    );
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("reads a host EMPTY as a real answer, so a last port really dies", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toEqual([]);
  });

  it("reads each host once, and only the hosts that have auto forwards", async () => {
    const ports = new Map<string, HostPorts>([
      ["pu-dev", listening([5173, 8080])],
    ]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 8080, origin: "auto" });
    await h.forwards.create({ host: ZEST, port: 3000, origin: "manual" });

    h.readHostPorts.forReap.mockClear();
    await h.forwards.reconcile();
    expect(h.readHostPorts.forReap.mock.calls.map(([host]) => host)).toEqual([
      PU,
    ]);
  });

  it("does not re-read the host for a target that is already open", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    h.readHostPorts.forOpeningClick.mockClear();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });
    expect(h.readHostPorts.forOpeningClick).not.toHaveBeenCalled();
  });

  it("reads the CLICK path on its own budget, and the reaper on the reaper's", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    expect(h.readHostPorts.forOpeningClick).toHaveBeenCalledWith(PU);
    expect(h.readHostPorts.forReap).not.toHaveBeenCalled();

    h.readHostPorts.forOpeningClick.mockClear();
    await h.forwards.reconcile();
    expect(h.readHostPorts.forReap).toHaveBeenCalledWith(PU);
    expect(h.readHostPorts.forOpeningClick).not.toHaveBeenCalled();
    expect(OPENING_CLICK_READ_BUDGET_MS).toBeLessThan(REAP_READ_BUDGET_MS);
  });

  it("reads nothing at all when there are no auto forwards", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    h.readHostPorts.forReap.mockClear();
    await h.forwards.reconcile();
    expect(h.readHostPorts.forReap).not.toHaveBeenCalled();
  });

  it("keeps a dead forward LISTED when its door refuses to close", async () => {
    const fake = fakeMechanisms();
    const ports = new Map<string, HostPorts>([["pu-dev", listening([])]]);
    const h = harness(ports, { onMechanisms: fake });
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    fake.refuseClose(true);
    await expect(h.forwards.reconcile()).resolves.toHaveLength(1);
    expect(h.forwards.list()).toHaveLength(1);

    fake.refuseClose(false);
    await h.forwards.reconcile();
    expect(h.forwards.list()).toEqual([]);
  });
});

describe("a forward the mechanism reports lost", () => {
  const logged = (lines: Array<Record<string, unknown>>) =>
    lines.map((line) => [pino.levels.labels[Number(line.level)], line.msg]);

  it("REPORTS a `gone` forward at warn, and survives doing it", async () => {
    const fake = fakeMechanisms();
    const h = harness(new Map(), { onMechanisms: fake });
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    h.published.length = 0;

    fake.reportFor(5173).lost("ssh transport went away");

    expect(logged(h.lines)).toEqual([
      ["warn", "port forward reported by its mechanism"],
    ]);
    expect(h.lines[0]).toMatchObject({
      key: "remote:pu-dev:5173",
      kind: "gone",
      reason: "ssh transport went away",
    });
    expect(h.published).toEqual([[]]);
    expect(h.forwards.list()).toEqual([]);
  });

  it("REPORTS a `degraded` forward at error, and keeps it listed", async () => {
    const fake = fakeMechanisms();
    const h = harness(new Map(), { onMechanisms: fake });
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });
    h.published.length = 0;

    fake
      .reportFor(5173)
      .fault("the relay's listener errored and would not close");

    expect(logged(h.lines)).toEqual([
      ["error", "port forward reported by its mechanism"],
    ]);
    expect(h.lines[0]).toMatchObject({ kind: "degraded" });
    expect(h.published).toHaveLength(1);
    expect(h.forwards.list()).toHaveLength(1);
  });
});

describe("a host leaving", () => {
  it("takes ITS forwards down, both origins", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 8080, origin: "manual" });
    await h.forwards.create({ host: ZEST, port: 3000, origin: "manual" });

    await h.forwards.hostDeparted(PU);
    expect(h.forwards.list().map((f) => f.host)).toEqual([
      { kind: "remote", target: "zest" },
    ]);
  });

  it("cancels a door still OPENING when its host leaves the pool", async () => {
    let land: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    const fake = fakeMechanisms();
    const slowOpen: ForwardMechanisms = {
      async open(target) {
        await held;
        return fake.mechanisms.open(target);
      },
    };
    const h = harness(new Map(), {
      onMechanisms: { ...fake, mechanisms: slowOpen },
    });

    const inFlight = h.forwards.create({
      host: PU,
      port: 5173,
      origin: "auto",
    });
    h.depart();
    const departed = h.forwards.hostDeparted(PU);
    land?.();
    await expect(inFlight).rejects.toThrow(/no longer has the host/);
    await departed;

    expect(h.forwards.list()).toEqual([]);
    expect(h.fake.closed).toEqual([]);
  });

  it("reports a host whose ONLY door is still opening", async () => {
    let land: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    const fake = fakeMechanisms();
    const slowOpen: ForwardMechanisms = {
      async open(target) {
        await held;
        return fake.mechanisms.open(target);
      },
    };
    const h = harness(new Map(), {
      onMechanisms: { ...fake, mechanisms: slowOpen },
    });

    const inFlight = h.forwards.create({
      host: PU,
      port: 5173,
      origin: "auto",
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(h.forwards.list()).toEqual([]);
    expect(h.forwards.heldHosts()).toEqual([PU]);

    land?.();
    await inFlight;
  });

  it("tears down an OPENING door when hostDeparted reaches it", async () => {
    let land: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    const fake = fakeMechanisms();
    const slowOpen: ForwardMechanisms = {
      async open(target) {
        await held;
        return fake.mechanisms.open(target);
      },
    };
    const h = harness(new Map(), {
      onMechanisms: { ...fake, mechanisms: slowOpen },
    });

    const inFlight = h.forwards.create({
      host: PU,
      port: 5173,
      origin: "auto",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.forwards.heldHosts()).toEqual([PU]);

    const departed = h.forwards.hostDeparted(PU);
    land?.();
    await inFlight.catch(() => {});
    await departed;

    expect(h.forwards.list()).toEqual([]);
    expect(h.forwards.heldHosts()).toEqual([]);
    expect(fake.closed).toEqual([5173]);
  });

  it("touches nothing when the departed host had none", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    const before = h.published.length;
    await h.forwards.hostDeparted(ZEST);
    expect(h.forwards.list()).toHaveLength(1);
    expect(h.published).toHaveLength(before);
  });
});

describe("what the cell sees", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness(new Map([["pu-dev", listening([])]]));
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

  it("REPORTS a reconciliation by returning it, and never by announcing", async () => {
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    const announcementsAfterCreate = h.published.length;

    const reported = await h.forwards.reconcile();

    expect(reported).toEqual([]);
    expect(h.forwards.list()).toEqual([]);
    expect(h.published).toHaveLength(announcementsAfterCreate);
  });

  it("announces nothing for an idle pass either", async () => {
    h.ports.set("pu-dev", listening([5173]));
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    const before = h.published.length;

    await h.forwards.reconcile();
    await h.forwards.reconcile();

    expect(h.forwards.list()).toHaveLength(1);
    expect(h.published).toHaveLength(before);
  });

  it("rejects a cancel for a key it does not hold", async () => {
    await expect(h.forwards.cancel("remote:pu-dev:5173")).rejects.toThrow();
  });

  it("empties the list on dispose", async () => {
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.dispose();
    expect(h.forwards.list()).toEqual([]);
    expect(h.published.at(-1)).toEqual([]);
  });

  it("still knows WHY a listener that survived dispose exists", async () => {
    const fake = fakeMechanisms();
    const h2 = harness(new Map(), { onMechanisms: fake });
    await h2.forwards.create({ host: PU, port: 5173, origin: "auto" });
    fake.refuseClose(true);

    await expect(h2.forwards.dispose()).rejects.toThrow();
    expect(h2.forwards.list().map((f) => f.origin)).toEqual(["auto"]);
  });
});

describe("the cell wiring — reconcile-on-a-fused-cadence", () => {
  function fusedCell(opts: {
    read: () => Promise<Forwards>;
    onChange: (tick: () => void) => () => void;
    cap: number;
  }) {
    let reads = 0;
    let runaway = false;
    let chain: Promise<void> = Promise.resolve();
    const pump = (): void => {
      chain = chain.then(async () => {
        if (runaway) return;
        reads += 1;
        if (reads > opts.cap) {
          runaway = true;
          return;
        }
        await opts.read();
      });
    };
    const stop = opts.onChange(pump);
    pump();
    return {
      tick: pump,
      settled: async () => {
        for (let i = 0; i < 200 && !runaway; i += 1) await chain;
        return { reads, runaway };
      },
      stop,
    };
  }

  it("CONVERGES under surface own convergence assertion (dogfood)", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    const listeners = new Set<() => void>();
    h.onChange = () => {
      for (const tick of listeners) tick();
    };
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await expect(
      assertCellConverges({
        build: (onRead) =>
          source<Forwards>({
            read: async () => {
              onRead();
              return h.forwards.reconcile();
            },
            install: everyMsOr(60_000, (tick) => {
              listeners.add(tick);
              return () => listeners.delete(tick);
            }),
            label: "forwards",
          }),
        kick: () => {
          for (const tick of [...listeners]) tick();
        },
        settleMs: 150,
      }),
    ).resolves.toMatchObject({ reads: expect.any(Number) });
  });

  it("does not reap a door the user PINNED while the reap was reading", async () => {
    const ports = new Map<string, HostPorts>();
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    ports.set("pu-dev", listening([]));
    let promote: (() => Promise<void>) | undefined;
    h.readHostPorts.forReap.mockImplementationOnce(async (host: HostKey) => {
      await promote?.();
      return (
        ports.get(host.kind === "local" ? "local" : host.target) ?? {
          status: "unobserved",
        }
      );
    });
    promote = async () => {
      await h.forwards.create({ host: PU, port: 5173, origin: "manual" });
    };

    await h.forwards.reconcile();

    expect(h.forwards.list().map((f) => f.remotePort)).toEqual([5173]);
    expect(h.fake.closed).toEqual([]);
  });

  it("CONVERGES with a live auto forward — the production freeze", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    const listeners = new Set<() => void>();
    const cell = fusedCell({
      read: () => h.forwards.reconcile(),
      onChange: (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      },
      cap: 25,
    });
    h.onChange = () => {
      for (const tick of listeners) tick();
    };

    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    const { reads, runaway } = await cell.settled();
    cell.stop();

    expect(runaway).toBe(false);
    expect(reads).toBeLessThanOrEqual(3);
  });

  it("CONVERGES when the reconciliation actually cancels something", async () => {
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    const listeners = new Set<() => void>();
    const cell = fusedCell({
      read: () => h.forwards.reconcile(),
      onChange: (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      },
      cap: 25,
    });
    h.onChange = () => {
      for (const tick of listeners) tick();
    };

    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await cell.settled();
    ports.set("pu-dev", listening([]));
    cell.tick();
    const { reads, runaway } = await cell.settled();
    cell.stop();

    expect(runaway).toBe(false);
    expect(reads).toBeLessThanOrEqual(4);
    expect(h.forwards.list()).toEqual([]);
  });
});
