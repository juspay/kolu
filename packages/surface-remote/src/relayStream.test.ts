/**
 * The two per-member stream relays, over hand-driven fake clients (no transport,
 * no session). Proves the behavioural split the forwarding policy names:
 *
 *   - `relayFailThroughStream` (delta) — forwards the current client 1:1 and ENDS
 *     the downstream stream when the upstream link dies, NEVER rebinding.
 *   - `relayHoldOpenStream` (value) — HOLDS the downstream open across an upstream
 *     drop, rebinding to the next spawn; the only exit is a downstream unsubscribe.
 *
 * Plus the type-level guard: holding open a delta member (or failing through a
 * value member) is a COMPILE error, so the "splice a replayed snapshot into a
 * live xterm" corruption is unrepresentable, not a rule to remember.
 *
 * Every "downstream aborts" case is now a fiber INTERRUPT (PLAN D10): the relays
 * carry no `AbortSignal`, so `stop()` from `runStreamScoped` is the whole of the
 * unsubscribe vocabulary — and the law each of those tests pins is unchanged
 * (a torn-down subscription reports nothing, ever).
 */

import { shouldRetryStreamError } from "@kolu/surface/client";
import {
  MapKeyUnknown,
  SurfaceRelayTransportLost,
  SurfaceStdioTransportClosed,
} from "@kolu/surface/errors";
import { Cause, Effect, Exit, Stream } from "effect";
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

/** Drain a relay's stream into a recorder — the Effect-native successor of the
 *  old `for await (… of relay(input, signal))`. `stop()` INTERRUPTS the
 *  subscription, which is what a downstream unsubscribe is now, and latches
 *  "stopped" first so a torn-down drain reports nothing at all (the same three
 *  rules `@kolu/surface`'s `runStreamScoped` holds for its Solid consumers —
 *  restated here because that module has no non-Solid subpath export). The raw
 *  failure VALUE is kept (not normalised to `Error`) so a test can assert the
 *  exact instance the relay failed with. */
function drain<T>(stream: Stream.Stream<T, unknown>) {
  const frames: T[] = [];
  let error: unknown = null;
  let ended = false;
  let stopped = false;
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (item: T) =>
      Effect.sync(() => {
        if (!stopped) frames.push(item);
      }),
    ),
  );
  fiber.addObserver((exit) => {
    if (stopped) return;
    if (Exit.isSuccess(exit)) {
      ended = true;
      return;
    }
    // Interruption is TEARDOWN, never a failure.
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    error = Cause.squash(exit.cause);
  });
  return {
    frames,
    stop: () => {
      stopped = true;
      fiber.interruptUnsafe();
    },
    get error() {
      return error;
    },
    get ended() {
      return ended;
    },
  };
}

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
    holder.current = { surface: { s: { get: () => up1.stream } } };

    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run = drain(relay({ id: "t1" }));

    up1.push("snapshot");
    up1.push("live-1");
    await delay();
    expect(run.frames).toEqual(["snapshot", "live-1"]);

    // Kill the middle hop: this spawn's upstream link dies mid-stream…
    up1.fail(new Error("stdio link died"));
    // …and even if the pump later swaps in a NEW live client, the fail-through
    // relay must NOT rebind onto it (splicing a fresh snapshot into a live byte
    // stream is exactly the corruption we forbid).
    const up2 = controllable<string>();
    holder.current = { surface: { s: { get: () => up2.stream } } };
    holder.onChange?.();
    up2.push("spliced-should-never-appear");
    await delay();

    // The downstream ends with the NAMED RETRYABLE transport end (SR5), NOT a raw
    // re-fail — so it crosses the wire against the shared schema and the browser
    // re-subscribes. The raw upstream error is preserved on `cause` for diagnosis.
    expect(run.error).toBeInstanceOf(RelayTransportLostError);
    expect(run.error).toBeInstanceOf(SurfaceRelayTransportLost);
    expect((run.error as SurfaceRelayTransportLost)._tag).toBe(
      "SurfaceRelayTransportLost",
    );
    expect(((run.error as Error).cause as Error).message).toBe(
      "stdio link died",
    );
    // The shared retry fence classifies it RETRYABLE (unlike any declared error).
    expect(shouldRetryStreamError(run.error)).toBe(true);
    expect(run.frames).toEqual(["snapshot", "live-1"]); // no spliced frame
    run.stop();
  });

  it("surfaces an APPLICATION error unchanged (non-retryable), only a TRANSPORT death becomes the retryable end", async () => {
    // The relay end is retryable ONLY for a genuine middle-hop transport loss. A
    // DECLARED error the agent raised (a map's `MapKeyUnknown` for a gone entry,
    // say) must cross unchanged and stay NON-retryable — else the fence retries a
    // permanent failure forever.
    const appErr = new MapKeyUnknown({ mapKey: "terminal-gone" });
    const up1 = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = { surface: { s: { get: () => up1.stream } } };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run1 = drain(relay({ id: "t1" }));
    up1.push("live");
    await delay();
    up1.fail(appErr);
    await delay();
    expect(run1.error).toBe(appErr); // the SAME error, unwrapped
    expect(run1.error).not.toBeInstanceOf(RelayTransportLostError);
    expect(shouldRetryStreamError(run1.error)).toBe(false); // declared → NOT retried
    run1.stop();

    // A genuine transport-death tag, by contrast, becomes the retryable relay end.
    const transportErr = new SurfaceStdioTransportClosed({
      reason: "stdio closed",
    });
    const up2 = controllable<string>();
    holder.current = { surface: { s: { get: () => up2.stream } } };
    const run2 = drain(relay({ id: "t2" }));
    up2.push("live");
    await delay();
    up2.fail(transportErr);
    await delay();
    expect(run2.error).toBeInstanceOf(RelayTransportLostError);
    expect(shouldRetryStreamError(run2.error)).toBe(true); // transport → retried
    run2.stop();
  });

  it("fails loud (NOT the retryable relay end) when the live client doesn't expose the member", async () => {
    // A structural mismatch — a version-skewed agent whose client lacks the member —
    // makes select(client) undefined BEFORE any network I/O. That must NOT be
    // classified as a transport loss (which the fence would retry forever); it is a
    // DEFECT, never wrapped as RelayTransportLostError.
    const holder = observableHolder<ByteClient>();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately a client missing member `s`.
    holder.current = { surface: {} } as any;
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run = drain(relay({ id: "t" }));
    await delay();
    expect(run.error).toBeInstanceOf(Error);
    expect(run.error).not.toBeInstanceOf(RelayTransportLostError);
    expect((run.error as Error).message).toMatch(
      /structural client\/surface mismatch/,
    );
    run.stop();
  });

  it("propagates a clean upstream end as a clean downstream end", async () => {
    const up = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run = drain(relay({ id: "t1" }));
    up.push("a");
    up.end(); // PTY exit, say — a genuine end, not a link death
    await delay();
    expect(run.ended).toBe(true);
    expect(run.error).toBeNull();
    expect(run.frames).toEqual(["a"]);
    run.stop();
  });

  it("WAITS for the next spawn when subscribed with no live client (no 1s retry spam, #1963)", async () => {
    // Pre-#1963: fail with RelayTransportLostError immediately → browser
    // STREAM_RETRY every 1s → a bare stack frame logged for the whole provisioning
    // window. Now: wait for the pump to set a live client, then forward 1:1
    // (fail-through still applies to mid-stream deaths).
    const holder = observableHolder<ByteClient>(); // current === null
    const logs: string[] = [];
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
      { log: (l) => logs.push(l) },
    );
    const run = drain(relay({ id: "t" }));
    // Still waiting — no failure, no frames.
    await delay(20);
    expect(run.error).toBeNull();
    expect(run.ended).toBe(false);
    expect(run.frames).toEqual([]);
    expect(logs.some((l) => /no live upstream yet/.test(l))).toBe(true);
    // Exactly ONE wait line even if we somehow re-enter — rate-limited.
    expect(logs.filter((l) => /no live upstream yet/.test(l))).toHaveLength(1);

    // Pump lands a spawn — the waiting relay binds and forwards.
    const up = controllable<string>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    holder.onChange?.();
    up.push("after-wait");
    up.end();
    await delay(20);
    expect(run.error).toBeNull();
    expect(run.frames).toEqual(["after-wait"]);
    run.stop();
  });

  it("reports NOTHING when torn down while waiting for a spawn", async () => {
    // Downstream unsubscribes while still provisioning (no live client yet).
    // Interruption is teardown, not a dead-link condition, so it must surface no
    // error to a client that already walked away — and no end either.
    const holder = observableHolder<ByteClient>(); // current === null
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run = drain(relay({ id: "t" }));
    await delay(5);
    run.stop();
    await delay(10);
    expect(run.error).toBeNull();
    expect(run.ended).toBe(false);
    expect(run.frames).toEqual([]);
    // …and a spawn landing AFTER the teardown wakes nothing.
    const up = controllable<string>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    holder.onChange?.();
    up.push("never-seen");
    await delay(10);
    expect(run.frames).toEqual([]);
  });

  it("reports NOTHING when torn down mid-stream", async () => {
    const up = controllable<string>();
    const holder = observableHolder<ByteClient>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run = drain(relay({ id: "t1" }));
    up.push("only");
    await delay();
    expect(run.frames).toEqual(["only"]);
    run.stop();
    await delay();
    // A frame pushed after the teardown, and a failure racing it, both go nowhere.
    up.push("after-stop");
    up.fail(new Error("racing the teardown"));
    await delay(10);
    expect(run.frames).toEqual(["only"]);
    expect(run.error).toBeNull();
    expect(run.ended).toBe(false);
  });

  it("reports NOTHING when torn down DURING the subscribe handshake", async () => {
    // A `get()` whose stream never emits and never ends — a real subscribe torn
    // down mid-handshake.
    const holder = observableHolder<ByteClient>();
    holder.current = {
      surface: { s: { get: () => controllable<string>().stream } },
    };
    const relay = relayFailThroughStream(
      POLICY,
      "liveBytes",
      holder,
      selectByte,
    );
    const run = drain(relay({ id: "t1" }));
    await delay();
    run.stop(); // tear down while the upstream is still parked
    await delay(10);
    expect(run.error).toBeNull(); // teardown → silence, not a spurious failure
    expect(run.ended).toBe(false);
  });
});

describe("relayHoldOpenStream (value)", () => {
  it("holds the downstream open across an upstream respawn and replays after rebind", async () => {
    const up1 = controllable<number>();
    const holder = observableHolder<PulseClient>();
    holder.current = { surface: { s: { get: () => up1.stream } } };

    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const run = drain(relay({ repo: "r" }));

    up1.push(1);
    await delay();
    expect(run.frames).toEqual([1]);

    // Upstream link BLIPS — a transport death FAILS this spawn's stream (a link
    // blip is a failure, never a clean end). The relay must HOLD — the downstream
    // stream must NOT complete.
    up1.fail(new Error("link blip"));
    await delay();
    expect(run.ended).toBe(false); // held, did not complete
    expect(run.error).toBeNull();

    // The pump swaps in the next spawn: the relay rebinds and keeps yielding.
    const up2 = controllable<number>();
    holder.current = { surface: { s: { get: () => up2.stream } } };
    holder.onChange?.();
    up2.push(2);
    await delay();
    expect(run.frames).toEqual([1, 2]); // held open across the drop, replayed after rebind

    // The ONLY exit is the downstream tearing down.
    run.stop();
  });

  it("surfaces a CLEAN upstream end while the client stays live — ends the downstream, does not park (candidate 3a)", async () => {
    // A one-shot value member (e.g. `terminalExit`) fires once then the source
    // ENDS cleanly, while the SAME client stays live (`holder.current` never
    // changes). Parking on the next client change would hang forever — so the
    // relay must SURFACE the completion and end the downstream (the client
    // re-subscribes end-to-end if it wants more).
    const up = controllable<number>();
    const holder = observableHolder<PulseClient>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const run = drain(relay({ repo: "r" }));

    up.push(7);
    up.end(); // one-shot / per-input clean end, link stays live
    await delay();

    expect(run.frames).toEqual([7]);
    expect(run.ended).toBe(true); // surfaced the end; never left parked
    // The holder still holds the SAME live client — the end was per-input, not a
    // link death, and the relay did not wait for a respawn that isn't coming.
    expect(holder.current).not.toBeNull();
    run.stop();
  });

  it("emits the optional lead frame on each bind", async () => {
    const up = controllable<number>();
    const holder = observableHolder<PulseClient>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse, {
      lead: { frame: 0 },
    });
    const run = drain(relay({ repo: "r" }));
    await delay();
    expect(run.frames).toEqual([0]); // lead led the stream before any upstream frame
    up.push(1);
    await delay();
    expect(run.frames).toEqual([0, 1]);

    // …and again on the REBIND after a blip: the lead is per-bind, so a consumer
    // re-queries current state after a reconnect.
    up.fail(new Error("link blip"));
    const up2 = controllable<number>();
    holder.current = { surface: { s: { get: () => up2.stream } } };
    holder.onChange?.();
    await delay();
    expect(run.frames).toEqual([0, 1, 0]);
    run.stop();
  });

  it("holds (does not complete) while no client is live, then binds when one appears", async () => {
    const holder = observableHolder<PulseClient>(); // current === null
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const run = drain(relay({ repo: "r" }));
    await delay();
    expect(run.ended).toBe(false); // holding for the first spawn, not completed

    const up = controllable<number>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    holder.onChange?.();
    up.push(7);
    await delay();
    expect(run.frames).toEqual([7]);
    run.stop();
  });

  it("leaves no waiter behind when torn down while holding for a spawn", async () => {
    // The rebind wait is an Effect whose finalizer detaches the waiter, so an
    // interrupted subscription cannot be woken by a later spawn (the old
    // `signal.removeEventListener` pair, structurally).
    const holder = observableHolder<PulseClient>();
    const relay = relayHoldOpenStream(POLICY, "pulse", holder, selectPulse);
    const run = drain(relay({ repo: "r" }));
    await delay();
    run.stop();
    await delay();

    const up = controllable<number>();
    holder.current = { surface: { s: { get: () => up.stream } } };
    holder.onChange?.();
    up.push(9);
    await delay(10);
    expect(run.frames).toEqual([]);
    expect(run.error).toBeNull();
    expect(run.ended).toBe(false);
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
