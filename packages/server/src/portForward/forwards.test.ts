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
  ForwardReport,
} from "@kolu/port-forward";
import { makeForwardManager } from "@kolu/port-forward";
import type { HostKey } from "kolu-common/hostKey";
import type { ForwardOrigin, Forwards } from "kolu-common/surface";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCellConverges } from "@kolu/surface/assert-cell-converges";
import { everyMsOr, source } from "@kolu/surface/reactor";
import {
  CREATE_READ_DEADLINE_MS,
  createKoluForwards,
  REAP_READ_DEADLINE_MS,
} from "./forwards.ts";
import type { HostPorts } from "./hostPorts.ts";

/** A REAL pino logger, at a level that actually LOGS, writing its lines into an
 *  array.
 *
 *  Deliberately not `pino({ level: "silent" })`, which is what stood here and is
 *  precisely why #2157 shipped. At `silent` pino swaps every level method for a
 *  shared `noop` that reads no `this` — so a DETACHED method
 *  (`const log = deps.log.warn`) sails through the whole suite and throws
 *  `TypeError: Cannot read properties of undefined (reading
 *  'Symbol(pino.msgPrefix)')` only in production, inside the one handler whose
 *  job is to REPORT a lost forward. A logger that formats for real is the only
 *  kind that can fail the way production fails, so every case in this file now
 *  uses one; the destination is an array, so the suite stays as quiet as before. */
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

/** A host reading: these ports are listening, all on v4.
 *
 *  The family is uniform here because no case in this file turns on it — the
 *  auto-cancel rule reads port NUMBERS, and which loopback a port is on is the
 *  library's concern once a door is opened. The one case that does care (a
 *  create picking its dial) states its own families inline. */
const listening = (ports: number[]): HostPorts => ({
  status: "known",
  ports: new Map(ports.map((port) => [port, "v4" as const])),
});

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
  /** The channel the mechanism was handed for a port's door, so a test can say
   *  "this forward died on its own" the way the real world does — through the
   *  map, not by reaching into the policy's `onLost` behind it. */
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
  const readHostPorts = vi.fn(
    async (host: HostKey, _deadlineMs: number): Promise<HostPorts> =>
      ports.get(host.kind === "local" ? "local" : host.target) ?? {
        status: "unknown",
      },
  );
  // The change edge, redirectable: most cases only want to COUNT announcements,
  // while the wiring cases below need to route them into a real re-read (which
  // is what production does, and what the freeze rode on). The edge carries no
  // payload, so a counting subscriber reads the list back itself — which is
  // exactly what the surface cell does.
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
    /** Every line this harness's logger actually FORMATTED — the proof that the
     *  report survived its own logging call. */
    lines,
    /** Take every host out of the pool — "kolu no longer has this machine". */
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
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    // Still listening: nothing happens.
    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);

    // The dev server died. The scan is a real observation that does not contain
    // the port, which is the only thing that may close the door.
    ports.set("pu-dev", listening([9229]));
    await h.forwards.reconcile();
    expect(h.forwards.list()).toEqual([]);
    expect(h.fake.closed).toEqual([5173]);
  });

  it("leaves a MANUAL forward standing when its port disappears", async () => {
    // A manual forward may point at something no scanner can see — a port
    // outside every terminal's subtree, a service started before kolu — so
    // "the scan does not list it" is its NORMAL state, not evidence of death.
    const ports = new Map<string, HostPorts>([["pu-dev", listening([])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("leaves an auto forward standing when the host could not be read", async () => {
    // The rule the whole `known`/`unknown` two-way exists for. "We could not
    // look" is not "nothing is listening"; treating it as one would tear down a
    // working forward every time a host hiccuped.
    const ports = new Map<string, HostPorts>([
      ["pu-dev", { status: "unknown" }],
    ]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("leaves an auto forward standing when the read THREW", async () => {
    // Same rule through the other door: a failed read is not evidence either,
    // and a caught error here must not collapse into an empty port set.
    const h = harness();
    h.readHostPorts.mockRejectedValue(new Error("the mirror is down"));
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toHaveLength(1);
  });

  it("reads a host EMPTY as a real answer, so a last port really dies", async () => {
    // The other side of the coin: a scanned host that serves nothing is an
    // observation, so the final auto forward on it must close. Without this the
    // `unknown` rule above would quietly mean forwards never die at all.
    const ports = new Map<string, HostPorts>([["pu-dev", listening([])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    await h.forwards.reconcile();
    expect(h.forwards.list()).toEqual([]);
  });

  it("reads each host once, and only the hosts that have auto forwards", async () => {
    // Cost tracks the feature's USE, not the size of the fleet: a kolu whose
    // user has never clicked a port chip reads nothing at all.
    const ports = new Map<string, HostPorts>([
      ["pu-dev", listening([5173, 8080])],
    ]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    await h.forwards.create({ host: PU, port: 8080, origin: "auto" });
    await h.forwards.create({ host: ZEST, port: 3000, origin: "manual" });

    h.readHostPorts.mockClear();
    await h.forwards.reconcile();
    expect(h.readHostPorts.mock.calls.map(([host]) => host)).toEqual([PU]);
  });

  it("does not re-read the host for a target that is already open", async () => {
    // The click path. A second create for a live target is the map's idempotent
    // hit, and the hit KEEPS the family the live door was opened with — so the
    // read cannot change the outcome and is pure latency in front of a user
    // watching a disabled button with a blank tab already open beside it.
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    h.readHostPorts.mockClear();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });
    expect(h.readHostPorts).not.toHaveBeenCalled();
  });

  it("gives the CLICK path a tighter read budget than the reaper's", async () => {
    // Two callers, two irreconcilable budgets — a background pass tolerates
    // seconds, a user staring at "opening…" does not — so each states its own
    // rather than inheriting one number.
    const ports = new Map<string, HostPorts>([["pu-dev", listening([5173])]]);
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    expect(h.readHostPorts.mock.calls.at(-1)?.[1]).toBe(
      CREATE_READ_DEADLINE_MS,
    );

    h.readHostPorts.mockClear();
    await h.forwards.reconcile();
    expect(h.readHostPorts.mock.calls.at(-1)?.[1]).toBe(REAP_READ_DEADLINE_MS);
    expect(CREATE_READ_DEADLINE_MS).toBeLessThan(REAP_READ_DEADLINE_MS);
  });

  it("reads nothing at all when there are no auto forwards", async () => {
    const h = harness();
    await h.forwards.create({ host: PU, port: 5173, origin: "manual" });

    h.readHostPorts.mockClear();
    await h.forwards.reconcile();
    expect(h.readHostPorts).not.toHaveBeenCalled();
  });

  it("keeps a dead forward LISTED when its door refuses to close", async () => {
    // A listener kolu could not shut is still out there. Dropping the row would
    // leave a door open with nothing left pointing at it; keeping it means the
    // next pass — or the user — can retry.
    const fake = fakeMechanisms();
    const ports = new Map<string, HostPorts>([["pu-dev", listening([])]]);
    const h = harness(ports, { onMechanisms: fake });
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    fake.refuseClose(true);
    // Reports the door as still there rather than throwing — the pass must not
    // abandon the remaining forwards over one that would not close.
    await expect(h.forwards.reconcile()).resolves.toHaveLength(1);
    expect(h.forwards.list()).toHaveLength(1);

    fake.refuseClose(false);
    await h.forwards.reconcile();
    expect(h.forwards.list()).toEqual([]);
  });
});

describe("a forward the mechanism reports lost", () => {
  // #2157: the handler whose whole job is to REPORT a loss killed the server
  // instead. It picked its level by selecting a method off the logger
  // (`const log = kind === "degraded" ? deps.log.error : deps.log.warn`), and
  // pino's level methods read their own `this` — so the first real loss (a
  // Tailscale key expiry dropped every ssh forward at once) threw
  // `TypeError: Cannot read properties of undefined (reading
  // 'Symbol(pino.msgPrefix)')` inside pino and took the process down for three
  // hours.
  //
  // Both cases drive the loss through the REAL map with a REAL logger, which is
  // the only combination that can catch this: a hand-written stub logger ignores
  // `this` entirely, and `pino({ level: "silent" })` — what this file used to
  // hold — is a `noop` that never reads it.
  //
  // What PINS the handler's survival is exactly two things: the formatted LINE,
  // and the change edge that `notify()` fires AFTER it. The library contains a
  // throwing consumer rather than propagating it (`announce` catches and re-raises
  // on its own turn), so a report that dies mid-flight never comes back to the
  // test body — it just leaves no line and no tick.
  //
  // The map's own state is NOT such a pin, and neither case claims it is: `lose`
  // settles the slot BEFORE it announces (`manager.ts` — `gone` deletes it,
  // `degraded` deliberately keeps it), so `list()` reads the same either way and
  // would pass over a handler that threw. It is asserted here as the loss
  // semantics it actually is, not as evidence anything survived.

  /** `[level, message]` for each line the logger actually formatted. */
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
    // The edge fired — the work AFTER the log line, which a throw inside the
    // report would have skipped. This is the survival pin, with the line above.
    expect(h.published).toEqual([[]]);
    // …and a `gone` loss drops the forward. The map had already done that before
    // it announced, so this says what a loss MEANS, not that anything survived.
    expect(h.forwards.list()).toEqual([]);
  });

  it("REPORTS a `degraded` forward at error, and keeps it listed", async () => {
    // A listener that broke and could NOT be cleaned up may still be reachable,
    // so the map keeps it — and the report of it is a genuine fault, not the
    // expected end of a door.
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
    // Kept, for the reason above — and again the map's own decision, taken
    // before the consumer ran rather than because it came back.
    expect(h.forwards.list()).toHaveLength(1);
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

  it("cancels a door still OPENING when its host leaves the pool", async () => {
    // `hostDeparted` walked the LIST, which is open slots only, so a create
    // still in flight was invisible to it. The flight then lands after the host
    // is gone and the door is live for a machine kolu no longer has — an
    // unauthenticated listener on every interface of the kolu server, with no
    // host tab left to cancel it from.
    //
    // The map already knew how to cancel an OPENING slot: it records the intent
    // and tears the flight down on arrival. What it could not do was ENUMERATE
    // one, which is the gap this closes.
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
    // The host leaves the pool while the door is still opening.
    h.depart();
    const departed = h.forwards.hostDeparted(PU);
    land?.();
    await expect(inFlight).rejects.toThrow(/no longer has the host/);
    await departed;

    expect(h.forwards.list()).toEqual([]);
    // …and no listener was ever handed out, so there is nothing orphaned on the
    // kolu server's interfaces.
    expect(h.fake.closed).toEqual([]);
  });

  it("reports a host whose ONLY door is still opening", async () => {
    // The production discovery path, which the first fix missed. Boot watches
    // the pool and asks "which hosts do we hold doors to?" — and it asked
    // `list()`, which is open slots only. A host whose single door is still in
    // flight therefore looked like a host with no doors at all, so
    // `hostDeparted` was never called for it and the enumeration fix inside it
    // never got a chance to run. The hole the fix was for stayed open, one
    // level up.
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
    // Let the scan read settle so the map is genuinely holding an OPENING slot.
    await new Promise((r) => setTimeout(r, 0));

    expect(h.forwards.list()).toEqual([]);
    expect(h.forwards.heldHosts()).toEqual([PU]);

    land?.();
    await inFlight;
  });

  it("tears down an OPENING door when hostDeparted reaches it", async () => {
    // The enumeration path on its own. The sibling test above asserts the
    // membership REFUSAL, which fires first and so never exercises this — grok
    // called that out, correctly. Here the host stays a member, so nothing is
    // refused and the only thing that can close the door is `hostDeparted`
    // finding it through `targets()` while it is still in flight.
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

    // The flight landed and the door was taken straight back down: nothing
    // listed, and the mechanism's listener was actually closed rather than
    // leaked.
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
    // …and publishes nothing, so an unrelated host's departure cannot tick every
    // reader of the list.
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
    // The production freeze, as a unit case. `reconcile` runs INSIDE the cell's
    // read, and the cell's change edge is what triggers that read — so a
    // reconcile that announces re-triggers itself, forever. It froze the whole
    // server on the first forward click.
    //
    // Asserted for the pass that CANCELS something, not just the idle one: a
    // "publish only when it changed" fix would still announce here and still
    // close the cycle, one lap slower. The only shape that cannot loop is one
    // that reports by returning.
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    const announcementsAfterCreate = h.published.length;

    // The host serves nothing now, so this pass really does cancel the forward.
    const reported = await h.forwards.reconcile();

    expect(reported).toEqual([]);
    expect(h.forwards.list()).toEqual([]);
    expect(h.published).toHaveLength(announcementsAfterCreate);
  });

  it("announces nothing for an idle pass either", async () => {
    // The cheaper half of the same property: a pass over a healthy forward has
    // nothing to say, and saying it anyway would tick every reader of the cell
    // once per interval forever.
    h.ports.set("pu-dev", listening([5173]));
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    const before = h.published.length;

    await h.forwards.reconcile();
    await h.forwards.reconcile();

    expect(h.forwards.list()).toHaveLength(1);
    expect(h.published).toHaveLength(before);
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

  it("still knows WHY a listener that survived dispose exists", async () => {
    // A close that fails leaves the listener in the map — visible and
    // retryable, which is the whole point — so the row for it must still say
    // what it is. It was an `auto` forward before dispose and it is one after;
    // a row that flipped to `pinned` would be the list inventing a reason the
    // user never gave, on the one row they now have to act on. That is exactly
    // what a side table cleared before the map went down produced.
    const fake = fakeMechanisms();
    const h2 = harness(new Map(), { onMechanisms: fake });
    await h2.forwards.create({ host: PU, port: 5173, origin: "auto" });
    fake.refuseClose(true);

    await expect(h2.forwards.dispose()).rejects.toThrow();
    expect(h2.forwards.list().map((f) => f.origin)).toEqual(["auto"]);
  });
});

describe("the cell wiring — reconcile-on-a-fused-cadence", () => {
  /** The fusion `surface.ts` actually installs, in miniature:
   *
   *    read    = deps.forwards.read           (which runs the reconciliation)
   *    install = everyMsOr(ms, onChange)      (so the change edge re-reads)
   *
   *  Only the EDGE half is modelled — the interval is a timer and not what
   *  froze production. What froze it is that `onChange` triggers `read`, so
   *  anything `read` announces comes straight back to `read`.
   *
   *  This harness is the smallest thing that can exhibit that, and it exists
   *  because neither half is wrong alone: the reap was reasonable, the fused
   *  cadence was reasonable, and the defect lived in the JOIN — which is exactly
   *  the shape a per-module unit test cannot see. */
  function fusedCell(opts: {
    read: () => Promise<Forwards>;
    onChange: (tick: () => void) => () => void;
    /** Reads allowed before the harness calls it a runaway. Bounded rather than
     *  awaited-forever so the pre-fix code FAILS here instead of hanging the
     *  suite — a test that hangs reports as infrastructure trouble, not as the
     *  bug it caught. */
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
    pump(); // the T+0 seed read
    return {
      /** One interval firing — the OTHER half of `everyMsOr`, driven explicitly
       *  rather than by a real timer so a test says when time passes. */
      tick: pump,
      settled: async () => {
        // Let the chain quiesce. Each lap of a true loop schedules the next, so
        // a runaway keeps extending `chain` and trips the cap rather than ending.
        for (let i = 0; i < 200 && !runaway; i += 1) await chain;
        return { reads, runaway };
      },
      stop,
    };
  }

  it("CONVERGES under surface own convergence assertion (dogfood)", async () => {
    // The same property this file already asserts with a hand-rolled harness,
    // now asked through the helper surface ships for it. Kept ALONGSIDE the
    // hand-rolled cases rather than replacing them: those model this cell~s
    // exact fusion, while this proves the shared helper actually catches the
    // shape it was generalized from — if the helper ever stopped working, a
    // green suite here would be the lie.
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
    // The reap decides which forwards are `auto` up front, then awaits a host
    // read — and that read is a real network-shaped await (a surface mirror,
    // bounded at seconds, not microseconds). A ⌘K "Forward a port…" for the same
    // target landing in that window promotes the door to `manual`, which is the
    // user saying "keep this until I say otherwise".
    //
    // Deciding before the await and acting after it means the promotion is
    // invisible to the pass that then closes the door. The user's explicit act
    // loses to a decision taken before they made it.
    const ports = new Map<string, HostPorts>();
    const h = harness(ports);
    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });

    // The listener is gone, so the reap WILL want to close this door…
    ports.set("pu-dev", listening([]));
    let promote: (() => Promise<void>) | undefined;
    h.readHostPorts.mockImplementationOnce(async (host: HostKey) => {
      // …and the pin lands while it is reading, exactly as a real click would.
      await promote?.();
      return (
        ports.get(host.kind === "local" ? "local" : host.target) ?? {
          status: "unknown",
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
    // Against the pre-fix code this trips the cap: create → publish → tick →
    // read → reap → publish → tick → … with no yield to anything else. On the
    // real server that was the whole event loop, so HTTP died and SIGTERM went
    // unanswered until systemd sent SIGKILL.
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
    // The forwards module announces on the SAME edge the cell subscribes to.
    h.onChange = () => {
      for (const tick of listeners) tick();
    };

    await h.forwards.create({ host: PU, port: 5173, origin: "auto" });
    const { reads, runaway } = await cell.settled();
    cell.stop();

    expect(runaway).toBe(false);
    // A seed read, plus the one the create's announcement earns. The exact
    // number matters less than that it is BOUNDED — but pinning it small keeps
    // a future change from quietly turning one extra read into ten.
    expect(reads).toBeLessThanOrEqual(3);
  });

  it("CONVERGES when the reconciliation actually cancels something", async () => {
    // The harder half: a pass that changes the map has something to say, which
    // is exactly when a "publish only when it changed" fix would still tick and
    // still close the cycle. Reporting by return is what bounds it.
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
    // The dev server dies. Nothing announces that — it is the INTERVAL half of
    // the fused cadence that notices, so drive one tick and let it settle.
    ports.set("pu-dev", listening([]));
    cell.tick();
    const { reads, runaway } = await cell.settled();
    cell.stop();

    expect(runaway).toBe(false);
    expect(reads).toBeLessThanOrEqual(4);
    expect(h.forwards.list()).toEqual([]);
  });
});
