/** Per-host Code-tab query OWNERSHIP (padi W9's Code-tab half, completing W7's K1).
 *  The acceptance suite for `perHostPolledQuery`: one `createPolledQuery` per host,
 *  born inside the retained `scopedByEntry` owner with `active = ctx.isActive`, so a
 *  host's query state is retained across switch-away, PAUSED while backgrounded,
 *  RESUMED from its held value on switch-BACK (no blank), and disposed on membership
 *  exit. This is the ownership shape the note calls for — not a keep-last cache.
 *
 *  Same real-owner fixture as `perHostWire.test.ts`: a REAL `scopedByEntry` over the
 *  shared mock `padiMap` (`hostScope/mockHostMap.testlib`), membership driven by
 *  `addHost`/`removeHost`, the active host by one module-stable signal. A hand-driven
 *  pulse (`unenrolledStreamCall` mocked) requeries the ACTIVE instance on demand. */

import type { HostKey } from "kolu-common/hostKey";
import { encodeHostKey } from "kolu-common/hostKey";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A single hand-driven pulse the ACTIVE instance subscribes to. `pulse()` fires one
// frame (→ one requery on whichever instance is currently polling); an instance that
// PAUSES aborts its subscription, so a pulse then reaches no torn-down instance.
const pulseCtl = vi.hoisted(() => ({
  latest: null as null | { emit: () => void },
}));
vi.mock("@kolu/surface/client", () => ({
  unenrolledStreamCall: async (
    _proc: unknown,
    _input: unknown,
    opts?: { signal?: AbortSignal },
  ) => {
    const queue: true[] = [];
    let wake: (() => void) | null = null;
    let ended = false;
    opts?.signal?.addEventListener("abort", () => {
      ended = true;
      wake?.();
    });
    pulseCtl.latest = {
      emit: () => {
        queue.push(true);
        wake?.();
        wake = null;
      },
    };
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended) {
          while (queue.length) {
            queue.shift();
            yield undefined;
          }
          if (ended) break;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      },
    };
  },
}));

const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));
vi.mock("../wire", async () => {
  const { mockPadiMap } = await import("../hostScope/mockHostMap.testlib");
  return { padiMap: mockPadiMap, activeHost: () => bag.activeHost() };
});

import {
  addHost,
  removeHost,
  resetHosts,
} from "../hostScope/mockHostMap.testlib";
import { perHostPolledQuery } from "./perHostPolledQuery";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const pulse = () => pulseCtl.latest?.emit();

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;

function switchTo(host: HostKey): void {
  batch(() => {
    addHost(host);
    setDriveHost(host);
  });
}

beforeEach(() => {
  resetHosts();
  setDriveHost(HOST_A);
});

describe("perHostPolledQuery — per-host query ownership (padi W9)", () => {
  it("retains each host's query across switch-away, resumes with no blank, and refreshes on return", async () => {
    await createRoot(async (dispose) => {
      try {
        let calls = 0;
        // The query labels its result by the host it ran on. It only ever runs for the
        // ACTIVE instance (active ⟺ this instance's host is the active host), so reading
        // the active host names THIS instance's own host — the exact property that lets
        // the shared closure stay correct across per-host instances.
        const q = perHostPolledQuery<
          { tick: number },
          unknown,
          unknown,
          string
        >({
          input: () => ({ tick: 0 }),
          pulseProc: () => (() => {}) as never,
          pulseInput: () => ({}),
          query: async () => {
            calls += 1;
            return `${encodeHostKey(driveHost())}#${calls}`;
          },
        });

        switchTo(HOST_A);
        await flush();
        pulse();
        await flush();
        expect(q()).toBe("local#1"); // A's instance loaded

        // Switch AWAY to B: A pauses (value held), B builds + blanks until its pulse.
        switchTo(HOST_B);
        await flush();
        expect(q.pending()).toBe(true); // B is fresh — blank
        pulse();
        await flush();
        expect(q()).toBe("remote:B#2"); // B loaded

        // Switch BACK to A: its instance was RETAINED, so A's held value shows with NO
        // blank (not pending) — the instant switch-back — then the pulse refreshes it.
        switchTo(HOST_A);
        await flush();
        expect(q.pending()).toBe(false); // resumed from held value, no blank
        expect(q()).toBe("local#1"); // A's retained value, instantly
        pulse();
        await flush();
        expect(q()).toBe("local#3"); // refreshed on activation
      } finally {
        dispose();
      }
    });
  });

  it("disposes a host's query when it leaves the pool (a re-add rebuilds fresh)", async () => {
    await createRoot(async (dispose) => {
      try {
        let calls = 0;
        const q = perHostPolledQuery<
          { tick: number },
          unknown,
          unknown,
          string
        >({
          input: () => ({ tick: 0 }),
          pulseProc: () => (() => {}) as never,
          pulseInput: () => ({}),
          query: async () => {
            calls += 1;
            return `${encodeHostKey(driveHost())}#${calls}`;
          },
        });

        switchTo(HOST_A);
        await flush();
        pulse();
        await flush();
        expect(q()).toBe("local#1");

        // Move to B, then A leaves the pool: A's owner (and its query instance) disposes.
        switchTo(HOST_B);
        await flush();
        pulse();
        await flush();
        removeHost(HOST_A);
        await flush();

        // Re-add + re-visit A: scopedByEntry treats it as a FRESH member (its prior
        // instance was disposed on exit), so it rebuilds and blanks — the held value did
        // NOT survive membership exit (ownership: dropped when gone).
        switchTo(HOST_A);
        await flush();
        expect(q.pending()).toBe(true); // rebuilt fresh, not resurrected
        pulse();
        await flush();
        expect(q()).toBe("local#3"); // a fresh load on the rebuilt instance
      } finally {
        dispose();
      }
    });
  });
});
