/**
 * The two per-member stream relays, over hand-driven fake clients (no transport,
 * no session). Proves the behavioural split the forwarding policy names:
 *
 *   - `relayFailThroughStream` (delta) — forwards the current client 1:1 and ENDS
 *     the downstream stream when the upstream link dies, NEVER rebinding.
 *   - `relayHoldOpenStream` (value) — HOLDS the downstream open across an upstream
 *     drop, rebinding to the next spawn; the only exit is a downstream abort.
 *
 * Plus the type-level guard: holding open a delta member (or failing through a
 * value member) is a COMPILE error, so the "splice a replayed snapshot into a
 * live xterm" corruption is unrepresentable, not a rule to remember.
 */

import {
  SURFACE_RELAY_TRANSPORT_LOST,
  SURFACE_STDIO_TRANSPORT_CLOSED,
  shouldNotRetryORPCError,
} from "@kolu/surface/client";
import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { controllable } from "./controllableStream.testutil";
import { observableHolder } from "./hostFanout";
import {
  type ForwardableStream,
  type RelayPolicy,
  RelayTransportLostError,
  relayFailThroughStream,
  relayHoldOpenStream,
} from "./relayStream";

const delay = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The shared retry fence is typed as a `Value<...>` union (a boolean OR a
// predicate), so pin it to the predicate form to call it — the same cast the
// `@kolu/surface-app` fence tests use.
const fence = shouldNotRetryORPCError as (a: { error: unknown }) => boolean;

const POLICY = {
  liveBytes: "delta",
  pulse: "value",
} as const satisfies RelayPolicy;

type ByteClient = { surface: { s: ForwardableStream<{ id: string }, string> } };
type PulseClient = {
  surface: { s: ForwardableStream<{ repo: string }, number> };
};
const selectByte = (c: ByteClient): ForwardableStream<{ id: string }, string> =>
  c.surface.s;
const selectPulse = (
  c: PulseClient,
): ForwardableStream<{ repo: string }, number> => c.surface.s;

describe("relayFailThroughStream (delta)", () => {
  it("forwards the current client 1:1, then ends the downstream when the upstream link dies — no rebind", async () => {
    const up1 = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up1.stream(opts?.signal) } },
    };

    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const frames: string[] = [];
    let error: unknown = null;
    const run = (async () => {
      try {
        for await (const f of relay({ id: "t1" }, undefined)) frames.push(f);
      } catch (err) {
        error = err;
      }
    })();

    up1.push("snapshot");
    up1.push("live-1");
    await delay();
    expect(frames).toEqual(["snapshot", "live-1"]);

    // Kill the middle hop: this spawn's upstream link dies mid-stream…
    up1.fail(new Error("stdio link died"));
    // …and even if the pump later swaps in a NEW live client, the fail-through
    // relay must NOT rebind onto it (splicing a fresh snapshot into a live byte
    // stream is exactly the corruption we forbid).
    const up2 = controllable<string>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up2.stream(opts?.signal) } },
    };
    holder.onChange?.();
    up2.push("spliced-should-never-appear");

    await run;
    // The downstream ends with the NAMED RETRYABLE transport end (SR5), NOT a raw
    // re-throw — so it crosses oRPC retryable and the browser re-subscribes. The
    // raw upstream error is preserved on `cause` for diagnosis.
    expect(error).toBeInstanceOf(RelayTransportLostError);
    expect((error as ORPCError<string, unknown>).code).toBe(
      SURFACE_RELAY_TRANSPORT_LOST,
    );
    expect(((error as Error).cause as Error).message).toBe("stdio link died");
    // The shared retry fence classifies it RETRYABLE (unlike any other ORPCError).
    expect(fence({ error })).toBe(true);
    expect(frames).toEqual(["snapshot", "live-1"]); // no spliced frame
  });

  it("surfaces an APPLICATION error unchanged (non-retryable), only a TRANSPORT death becomes the retryable end", async () => {
    // The relay end is retryable ONLY for a genuine middle-hop transport loss. An
    // application ORPCError the agent raised (NOT_FOUND for a gone terminal, say)
    // must cross unchanged and stay NON-retryable — else the fence retries a
    // permanent failure forever.
    const appErr = new ORPCError("NOT_FOUND", { message: "terminal gone" });
    const up1 = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up1.stream(opts?.signal) } },
    };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    let appError: unknown = null;
    const run1 = (async () => {
      try {
        for await (const _ of relay({ id: "t1" }, undefined)) {
          /* consume */
        }
      } catch (err) {
        appError = err;
      }
    })();
    up1.push("live");
    await delay();
    up1.fail(appErr);
    await run1;
    expect(appError).toBe(appErr); // the SAME error, unwrapped
    expect(appError).not.toBeInstanceOf(RelayTransportLostError);
    expect(fence({ error: appError })).toBe(false); // application error → NOT retried

    // A genuine transport-death code, by contrast, becomes the retryable relay end.
    const transportErr = new ORPCError(SURFACE_STDIO_TRANSPORT_CLOSED, {
      message: "stdio closed",
    });
    const up2 = controllable<string>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up2.stream(opts?.signal) } },
    };
    let relayError: unknown = null;
    const run2 = (async () => {
      try {
        for await (const _ of relay({ id: "t2" }, undefined)) {
          /* consume */
        }
      } catch (err) {
        relayError = err;
      }
    })();
    up2.push("live");
    await delay();
    up2.fail(transportErr);
    await run2;
    expect(relayError).toBeInstanceOf(RelayTransportLostError);
    expect((relayError as ORPCError<string, unknown>).code).toBe(
      SURFACE_RELAY_TRANSPORT_LOST,
    );
    expect(fence({ error: relayError })).toBe(true); // transport loss → retried
  });

  it("propagates a clean upstream end as a clean downstream end", async () => {
    const up = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up.stream(opts?.signal) } },
    };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const frames: string[] = [];
    const run = (async () => {
      for await (const f of relay({ id: "t1" }, undefined)) frames.push(f);
    })();
    up.push("a");
    up.end(); // PTY exit, say — a genuine end, not a link death
    await run; // resolves cleanly (no throw)
    expect(frames).toEqual(["a"]);
  });

  it("throws the RETRYABLE RelayTransportLostError when subscribed with no live client", async () => {
    const holder = observableHolder<ByteClient>(); // current === null
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    let error: unknown = null;
    await (async () => {
      try {
        for await (const _ of relay({ id: "t" }, undefined)) {
          /* consume */
        }
      } catch (err) {
        error = err;
      }
    })();
    expect(error).toBeInstanceOf(RelayTransportLostError);
    expect((error as ORPCError<string, unknown>).code).toBe(
      SURFACE_RELAY_TRANSPORT_LOST,
    );
    // The shared retry fence classifies the no-live-upstream end RETRYABLE too, so
    // a subscribe before the link is up re-subscribes once it comes back.
    expect(fence({ error })).toBe(true);
  });

  it("ends cleanly (no RelayTransportLostError) on an already-aborted subscribe with no live upstream", async () => {
    // A teardown can race an upstream drop: the downstream aborts while
    // `holder.current` is null, and the generator is first pulled AFTER the abort.
    // That abort is teardown, not a dead-link condition, so it must end cleanly —
    // NOT surface a spurious RelayTransportLostError to a client that already walked
    // away (the abort check precedes the `client === null` branch).
    const holder = observableHolder<ByteClient>(); // current === null
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const ctl = new AbortController();
    ctl.abort(); // downstream torn down before the first pull
    let error: unknown = null;
    const frames: string[] = [];
    try {
      for await (const f of relay({ id: "t" }, ctl.signal)) frames.push(f);
    } catch (err) {
      error = err;
    }
    expect(error).toBeNull(); // clean return, not RelayTransportLostError
    expect(frames).toEqual([]);
  });

  it("ends cleanly (no throw) on a downstream abort", async () => {
    const up = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up.stream(opts?.signal) } },
    };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const ctl = new AbortController();
    const frames: string[] = [];
    const run = (async () => {
      for await (const f of relay({ id: "t1" }, ctl.signal)) {
        frames.push(f);
        ctl.abort(); // downstream unsubscribes after the first frame
      }
    })();
    up.push("only");
    await run;
    expect(frames).toEqual(["only"]);
  });

  it("ends cleanly (no throw) on a downstream abort DURING the subscribe handshake", async () => {
    // A `get()` that stays pending until the caller's signal aborts, then rejects
    // with the signal reason — a real oRPC subscribe torn down mid-handshake.
    const holder = observableHolder<ByteClient>();
    holder.current = {
      surface: {
        s: {
          get: (_input, opts) =>
            new Promise<AsyncIterable<string>>((_resolve, reject) => {
              opts?.signal?.addEventListener(
                "abort",
                () => reject(opts.signal?.reason),
                { once: true },
              );
            }),
        },
      },
    };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const ctl = new AbortController();
    let threw = false;
    const run = (async () => {
      try {
        for await (const _ of relay({ id: "t1" }, ctl.signal)) {
          /* no frames before the abort */
        }
      } catch {
        threw = true;
      }
    })();
    await delay();
    ctl.abort(); // abort while the subscribe handshake (get()) is still pending
    await run;
    expect(threw).toBe(false); // handshake abort → clean return, not a spurious throw
  });
});

describe("relayHoldOpenStream (value)", () => {
  it("holds the downstream open across an upstream respawn and replays after rebind", async () => {
    const up1 = controllable<number>();
    const holder = observableHolder<PulseClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up1.stream(opts?.signal) } },
    };

    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const frames: number[] = [];
    const ctl = new AbortController();
    let completed = false;
    const run = (async () => {
      for await (const f of relay({ repo: "r" }, ctl.signal)) frames.push(f);
      completed = true;
    })();

    up1.push(1);
    await delay();
    expect(frames).toEqual([1]);

    // Upstream link BLIPS — a transport death rejects this spawn's stream (a link
    // blip is an ERROR, never a clean end). The relay must HOLD — the downstream
    // stream must NOT complete.
    up1.fail(new Error("link blip"));
    await delay();
    expect(completed).toBe(false); // held, did not complete

    // The pump swaps in the next spawn: the relay rebinds and keeps yielding.
    const up2 = controllable<number>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up2.stream(opts?.signal) } },
    };
    holder.onChange?.();
    up2.push(2);
    await delay();
    expect(frames).toEqual([1, 2]); // held open across the drop, replayed after rebind

    // The ONLY exit is a downstream abort.
    ctl.abort();
    up2.fail(new Error("teardown")); // wake the forward loop so it observes the abort
    await run;
  });

  it("surfaces a CLEAN upstream end while the client stays live — ends the downstream, does not park (candidate 3a)", async () => {
    // A one-shot value member (e.g. `terminalExit`) fires once then the source
    // ENDS cleanly, while the SAME client stays live (`holder.current` never
    // changes). Parking on `whenChanged` would hang forever — so the relay must
    // SURFACE the completion and end the downstream (the client re-subscribes
    // end-to-end if it wants more).
    const up = controllable<number>();
    const holder = observableHolder<PulseClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up.stream(opts?.signal) } },
    };
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const frames: number[] = [];
    let ended = false;
    const run = (async () => {
      for await (const f of relay({ repo: "r" }, undefined)) frames.push(f);
      ended = true; // the downstream COMPLETED — did not park
    })();

    up.push(7);
    up.end(); // one-shot / per-input clean end, link stays live
    await delay();

    expect(frames).toEqual([7]);
    expect(ended).toBe(true); // surfaced the end; the client was never left parked
    // The holder still holds the SAME live client — the end was per-input, not a
    // link death, and the relay did not wait for a respawn that isn't coming.
    expect(holder.current).not.toBeNull();
    await run;
  });

  it("emits the optional lead frame on each bind", async () => {
    const up = controllable<number>();
    const holder = observableHolder<PulseClient>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up.stream(opts?.signal) } },
    };
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse, {
      lead: { frame: 0 },
    });
    const frames: number[] = [];
    const ctl = new AbortController();
    const run = (async () => {
      for await (const f of relay({ repo: "r" }, ctl.signal)) frames.push(f);
    })();
    await delay();
    expect(frames).toEqual([0]); // lead led the stream before any upstream frame
    up.push(1);
    await delay();
    expect(frames).toEqual([0, 1]);
    ctl.abort();
    up.fail(new Error("teardown"));
    await run;
  });

  it("holds (does not complete) while no client is live, then binds when one appears", async () => {
    const holder = observableHolder<PulseClient>(); // current === null
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const frames: number[] = [];
    const ctl = new AbortController();
    let settled = false;
    const run = (async () => {
      for await (const f of relay({ repo: "r" }, ctl.signal)) frames.push(f);
      settled = true;
    })();
    await delay();
    expect(settled).toBe(false); // holding for the first spawn, not completed

    const up = controllable<number>();
    holder.current = {
      surface: { s: { get: async (_i, opts) => up.stream(opts?.signal) } },
    };
    holder.onChange?.();
    up.push(7);
    await delay();
    expect(frames).toEqual([7]);
    ctl.abort();
    up.fail(new Error("teardown"));
    await run;
  });
});

// ── Compile-time guard: the policy refuses the wrong member class ───────────
//
// These never run — they assert the TYPE. `@ts-expect-error` fails the build if
// the line does NOT error, so it pins the guard: a byte stream can't be held open
// and a value member can't be failed through. This is the "type error, not a
// convention" the note demands — the corruption is unspellable.
function _typeGuards(): void {
  const holder = observableHolder<{
    surface: Record<string, ForwardableStream<unknown, unknown>>;
  }>();
  const sel = (c: {
    surface: Record<string, ForwardableStream<unknown, unknown>>;
  }): ForwardableStream<unknown, unknown> =>
    c.surface.x as ForwardableStream<unknown, unknown>;

  // @ts-expect-error — "liveBytes" is a delta member; it cannot be held open.
  relayHoldOpenStream(POLICY, "liveBytes", holder, sel);
  // @ts-expect-error — "pulse" is a value member; it cannot be failed through.
  relayFailThroughStream(POLICY, "pulse", holder, sel);

  // The correct pairings compile.
  relayHoldOpenStream(POLICY, "pulse", holder, sel);
  relayFailThroughStream(POLICY, "liveBytes", holder, sel);
}
void _typeGuards;
