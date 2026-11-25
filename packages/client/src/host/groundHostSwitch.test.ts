/** The grounded active-host WRITE (`wire.ts`'s `setActiveHost`).
 *
 *  wire.ts installs exactly the setter this file drives — `createGroundedHostSetter`
 *  over the pool, the raw intent signal and the toast — so a write that stopped
 *  grounding, or stopped saying so, is red here without mounting the wire
 *  singleton (sockets, the host map, sessionStorage hydration). */

import { type HostKey, LOCAL_HOST } from "kolu-common/hostKey";
import { describe, expect, it } from "vitest";
import {
  createGroundedHostSetter,
  groundHostSwitch,
  hostDepartedMessage,
} from "./groundHostSwitch.ts";

const ZEST: HostKey = { kind: "remote", target: "zest" };
const WEST: HostKey = { kind: "remote", target: "west" };

/** The setter as wire.ts builds it, over a plain seat + toast log. */
function harness(members: HostKey[]) {
  let current: HostKey = LOCAL_HOST;
  const warnings: string[] = [];
  const setActiveHost = createGroundedHostSetter({
    members: () => members,
    intent: () => current,
    seat: (host) => {
      current = host;
      return host;
    },
    localHost: LOCAL_HOST,
    warn: (message) => warnings.push(message),
  });
  return { setActiveHost, current: () => current, warnings };
}

describe("the grounded active-host setter", () => {
  it("seats the local default and names the requested host once, for a non-member write", () => {
    // A surface named a host that has since left: an attention jump off a
    // notification, a palette row built before the pool moved. Seating it
    // would strand the tab on a dead host.
    const h = harness([LOCAL_HOST, WEST]);
    h.setActiveHost(ZEST);
    expect(h.current()).toEqual(LOCAL_HOST);
    // The toast is about the host the WRITE asked for, not the one it landed
    // on, and there is exactly one of it.
    expect(h.warnings).toEqual([hostDepartedMessage(ZEST)]);
    expect(h.warnings[0]).toContain("zest");
  });

  it("seats a member write silently", () => {
    const h = harness([LOCAL_HOST, ZEST]);
    h.setActiveHost(ZEST);
    expect(h.current()).toEqual(ZEST);
    expect(h.warnings).toEqual([]);
  });

  it("grounds an updater-shaped write off the current host", () => {
    const h = harness([LOCAL_HOST, ZEST]);
    h.setActiveHost(ZEST);
    h.setActiveHost((prev) => (prev.kind === "remote" ? WEST : LOCAL_HOST));
    // `west` is not a member — the updater's answer is grounded like any other.
    expect(h.current()).toEqual(LOCAL_HOST);
    expect(h.warnings).toEqual([hostDepartedMessage(WEST)]);
  });

  it("is a no-op before the first membership snapshot", () => {
    // The warming window: an empty keyset is "nothing to ground against", not
    // "nobody is a member" — else every boot would bounce to local and toast.
    const h = harness([]);
    h.setActiveHost(ZEST);
    expect(h.current()).toEqual(ZEST);
    expect(h.warnings).toEqual([]);
  });
});

describe("groundHostSwitch", () => {
  it("answers the request itself for a member, and the local default for a departed one", () => {
    expect(groundHostSwitch([LOCAL_HOST, ZEST], ZEST, LOCAL_HOST)).toEqual({
      target: ZEST,
      departed: null,
    });
    expect(groundHostSwitch([LOCAL_HOST], ZEST, LOCAL_HOST)).toEqual({
      target: LOCAL_HOST,
      departed: ZEST,
    });
  });
});
