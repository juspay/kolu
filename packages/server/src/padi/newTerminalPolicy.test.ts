/**
 * The new-terminal policy PUSHER (#2045) — kolu-server's half of "every face gets the
 * user's theme setting". padi's `newTerminalPolicy` cell is memory-only, so what makes
 * it true is exactly this: a push on every honest connect (first bind AND reconnect),
 * a re-push on every policy-input change, and nothing in between.
 *
 * Driven against two-line fakes (the `padiMemoryGate.test.ts` idiom) — the module's
 * pool/session/client slices are narrow on purpose, so no real padi is needed to pin
 * the policy.
 */

import type { Logger } from "@kolu/log";
import type { NewTerminalPolicy } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  installNewTerminalPolicyPusher,
  type NewTerminalPolicySession,
} from "./newTerminalPolicy.ts";

const INHERIT: NewTerminalPolicy = { kind: "inherit" };
const SHUFFLE_LIGHT: NewTerminalPolicy = { kind: "shuffle", mode: "light" };

const log = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

/** Let the fire-and-forget push (a `.then` chain off `currentClient()`) settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A fake padi session: a snapshot-then-delta `onState`, an honest `currentState`, and
 *  a client whose `set` records what it was handed. `client: null` models the (anomalous)
 *  connected-but-clientless session; `failSet` models a padi refusing the write. */
function fakeSession(opts: { client?: "none"; failSet?: boolean } = {}) {
  const listeners = new Set<(s: { phase: string }) => void>();
  let state = { phase: "connecting" };
  const pushed: NewTerminalPolicy[] = [];
  const client = {
    surface: {
      newTerminalPolicy: {
        set: async (policy: NewTerminalPolicy) => {
          if (opts.failSet === true) throw new Error("contract skew");
          pushed.push(policy);
        },
      },
    },
  };
  const session: NewTerminalPolicySession = {
    onState(cb) {
      listeners.add(cb);
      cb(state); // snapshot-then-delta, exactly as a real session seeds
      return () => {
        listeners.delete(cb);
      };
    },
    currentState: () => state,
    currentClient: () =>
      opts.client === "none" ? null : Promise.resolve(client),
  };
  return {
    session,
    pushed,
    /** Move the session to a phase and publish the frame. */
    to(phase: string) {
      state = { phase };
      for (const l of [...listeners]) l(state);
    },
  };
}

/** A fake pool: membership + the session behind a key, with a change edge. */
function fakePool() {
  const sessions = new Map<string, NewTerminalPolicySession>();
  const subs = new Set<() => void>();
  const fire = () => {
    for (const s of [...subs]) s();
  };
  return {
    pool: {
      hosts: () => [...sessions.keys()],
      getSession: (h: string) => sessions.get(h),
      subscribe: (cb: () => void) => {
        subs.add(cb);
        return () => {
          subs.delete(cb);
        };
      },
    },
    add(host: string, s: NewTerminalPolicySession) {
      sessions.set(host, s);
      fire();
    },
    remove(host: string) {
      sessions.delete(host);
      fire();
    },
  };
}

describe("installNewTerminalPolicyPusher — the connect edge", () => {
  it("pushes the current policy when a member turns connected, not while it dials", async () => {
    const pool = fakePool();
    const local = fakeSession();
    pool.add("local", local.session);
    installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log,
    });

    // Seeded at `connecting` — a dialing session is NOT a live one, even though its
    // `currentClient()` is non-null (the retired `currentClient() !== null` gate).
    await settle();
    expect(local.pushed).toEqual([]);

    local.to("connected");
    await settle();
    expect(local.pushed).toEqual([INHERIT]);
  });

  it("pushes AGAIN on a reconnect — a fresh padi's memory-only cell holds the baked default", async () => {
    const pool = fakePool();
    const local = fakeSession();
    pool.add("local", local.session);
    installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log,
    });

    local.to("connected");
    local.to("disconnected");
    local.to("connected");
    await settle();
    expect(local.pushed).toEqual([INHERIT, INHERIT]);
  });

  it("does not re-push on an unrelated frame from an already-connected member", async () => {
    const pool = fakePool();
    const local = fakeSession();
    pool.add("local", local.session);
    installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log,
    });

    local.to("connected");
    local.to("connected"); // e.g. a clock-offset stamp on the same live link
    await settle();
    expect(local.pushed).toEqual([INHERIT]);
  });

  it("pushes to a host that joins the pool later, once it connects", async () => {
    const pool = fakePool();
    const local = fakeSession();
    pool.add("local", local.session);
    installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log,
    });

    const guest = fakeSession();
    pool.add("guest", guest.session);
    guest.to("connected");
    await settle();
    expect(guest.pushed).toEqual([INHERIT]);
  });
});

describe("installNewTerminalPolicyPusher — republish", () => {
  it("re-derives and pushes to every connected member, skipping a down one", async () => {
    const pool = fakePool();
    const local = fakeSession();
    const guest = fakeSession();
    pool.add("local", local.session);
    pool.add("guest", guest.session);
    let policy: NewTerminalPolicy = INHERIT;
    const pusher = installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => policy,
      log,
    });

    local.to("connected");
    guest.to("connected");
    await settle();

    guest.to("disconnected");
    // The preference moved: the policy is re-READ at push time, never captured at
    // install time.
    policy = SHUFFLE_LIGHT;
    pusher.republish();
    await settle();

    expect(local.pushed).toEqual([INHERIT, SHUFFLE_LIGHT]);
    expect(guest.pushed).toEqual([INHERIT]);
  });

  it("pushes nothing to a host that has left the pool", async () => {
    const pool = fakePool();
    const guest = fakeSession();
    pool.add("guest", guest.session);
    const pusher = installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log,
    });

    guest.to("connected");
    await settle();
    pool.remove("guest");
    pusher.republish();
    await settle();

    expect(guest.pushed).toEqual([INHERIT]);
  });
});

describe("installNewTerminalPolicyPusher — a failing push", () => {
  it("logs at error and keeps running (never rethrows into the family's listener)", async () => {
    const pool = fakePool();
    const local = fakeSession({ failSet: true });
    pool.add("local", local.session);
    const errors = vi.fn();
    installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log: { ...log, error: errors } as unknown as Logger,
    });

    expect(() => local.to("connected")).not.toThrow();
    await settle();
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("logs at error when a connected session has no client at all", async () => {
    const pool = fakePool();
    const local = fakeSession({ client: "none" });
    pool.add("local", local.session);
    const errors = vi.fn();
    installNewTerminalPolicyPusher({
      pool: pool.pool,
      getPolicy: () => INHERIT,
      log: { ...log, error: errors } as unknown as Logger,
    });

    local.to("connected");
    await settle();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(local.pushed).toEqual([]);
  });
});
