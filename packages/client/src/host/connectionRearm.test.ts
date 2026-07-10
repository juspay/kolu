import { LOCAL_HOST } from "kolu-common/hostKey";
import type { HostKey } from "kolu-common/surfacesWithPadi";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createRejoinKeyedSub, isRejoin } from "./connectionRearm.ts";

const remoteA: HostKey = { kind: "remote", target: "srid@boxA" };

/** Flush queued reactive effects. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("isRejoin — the re-arm trigger", () => {
  it("fires only on absent→present", () => {
    expect(isRejoin(true, false)).toBe(true); // re-joined
    expect(isRejoin(true, true)).toBe(false); // stayed present
    expect(isRejoin(false, true)).toBe(false); // departed
    expect(isRejoin(false, false)).toBe(false); // stayed absent
  });
});

describe("createRejoinKeyedSub — connection cell re-arm on membership re-join (d1)", () => {
  it("opens a FRESH subscription when the active host departs then re-joins (not a dead strand)", async () => {
    let opens = 0;
    // A mock per-host cell subscription: each `open` is a fresh server-side stream. We count
    // opens to prove a re-join re-subscribes (the recovery), and drive a value per open.
    const openedFor: HostKey[] = [];
    const [tickValue, setTickValue] = createSignal("v0");
    const handles = createRoot((dispose) => {
      const [members, setMembers] = createSignal<HostKey[]>([
        LOCAL_HOST,
        remoteA,
      ]);
      const [activeHost] = createSignal<HostKey>(remoteA);
      const value = createRejoinKeyedSub<string>(
        activeHost,
        () => members(),
        (host) => {
          opens += 1;
          openedFor.push(host);
          return tickValue; // this "subscription" delivers tickValue
        },
      );
      return { setMembers, value, dispose };
    });
    await tick();
    expect(opens).toBe(1); // initial subscription
    expect(handles.value()).toBe("v0");

    // The active host FLAPS out of membership (a transient remove) — the server ends the
    // per-entry stream typed; the client would strand here without a re-arm.
    handles.setMembers([LOCAL_HOST]);
    await tick();
    expect(opens).toBe(1); // no re-open on departure

    // …then RE-JOINS (re-add) while the transport is still live → a fresh subscription opens,
    // so the cell resumes delivering instead of staying stranded.
    handles.setMembers([LOCAL_HOST, remoteA]);
    await tick();
    expect(opens).toBe(2); // re-armed — a NEW stream

    // The fresh subscription delivers new frames.
    setTickValue("v1");
    await tick();
    expect(handles.value()).toBe("v1");
    handles.dispose();
  });
});
