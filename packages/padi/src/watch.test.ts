/**
 * The watch kit's PURE tests — no socket, no daemon. Two halves:
 *
 *   - the wait predicate over a composed record (`agentMatchesUntil`), moved here
 *     (verbatim fixtures) from padi-tui's `render.test.ts` when it graduated into
 *     the dial kit's watch module;
 *   - `awaitOutputMatch` over a hand-rolled fake `PadiSurfaceClient` — the same
 *     fake-stream idiom `read.test.ts` uses (a pushable {@link FakeSource} per
 *     member, `Stream`s handed back lazily and synchronously, teardown by fiber
 *     interruption), which is what makes the match watcher testable at all
 *     without a PTY.
 *
 * `awaitAgentState`'s live behavior (seeded-gone reconciliation, already-in-bucket
 * met) stays pinned in `read.test.ts` over the same harness.
 *
 * What the match suite pins, and why each one is load-bearing rather than
 * decorative — every one of these is a property the watcher's shape promises and
 * nothing else checks:
 *
 *   1. a sentinel SPLIT across two deltas still matches (the whole reason a scan
 *      carries an overlap forward at all);
 *   2. a match WINS over an already-latched `terminalExit` (the ordering race the
 *      architecture pass fixed by NOT settling on the exit — a structural fix
 *      with no regression pin until now);
 *   3. an exit that latches and a feed that ends with NO match is `gone`, decided
 *      WITHOUT a membership round-trip (the keys stream here fails if read);
 *   4. the carry RESETS across a retry-fence re-subscribe, so two halves either
 *      side of a reconnect cannot forge a sentinel nobody printed;
 *   5. `snapshot` frames are NOT scanned (old news must not read as fresh);
 *   6. a `/g` pattern's `lastIndex` can neither cause a miss nor be mutated;
 *   7. the scan window is BOUNDED (overlap + the new delta) rather than the whole
 *      history — pinned deterministically by a RegExp that records what it was
 *      handed, and again on the wall clock, because the bound is what keeps the
 *      wait's own `--timeout` timer reachable on the event loop;
 *   8. the overlap trim never cuts a surrogate pair in half.
 *
 * NOT pinned, deliberately: that a CATASTROPHIC pattern (`(a+)+$`) against
 * hostile output still honors `--timeout`. It does not, and the bounded window
 * does not make it — one search over a 4096-unit carry with such a pattern is
 * already unbounded in time (measured on the dev box: `/a*a*Z/`, a merely
 * polynomial pattern, takes ~12s over 4096 `a`s). The bound removes the
 * per-frame multiplier, not the exponent; a test asserting otherwise would
 * either hang or pass vacuously. See `awaitOutputMatch`'s header, which names the
 * residual.
 */
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PadiSurfaceClient } from "./dial.ts";
import type { PadiTerminal } from "./surface.ts";
import { agentMatchesUntil, awaitOutputMatch, WAIT_STATES } from "./watch.ts";

/** A minimal `active` composed record — the agent the wait predicate reads.
 *  Cast because the full `ActiveTerminalSchema` is large and these are the
 *  only fields under test. */
function activeWithAgent(agent: AgentInfo | null): PadiTerminal {
  return {
    state: "active",
    agent,
    git: null,
    pr: { kind: "pending" },
    foreground: null,
  } as unknown as PadiTerminal;
}

const claude = (state: AgentInfo["state"]): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

describe("agentMatchesUntil — the wait predicate over a composed record", () => {
  const awaitingOrWaiting = new Set(["awaiting", "waiting"]);

  it("matches an agent whose bucket is in the targets", () => {
    expect(
      agentMatchesUntil(
        activeWithAgent(claude("awaiting_user")),
        awaitingOrWaiting,
      ),
    ).toBe(true);
    expect(
      agentMatchesUntil(activeWithAgent(claude("waiting")), awaitingOrWaiting),
    ).toBe(true);
  });

  it("does NOT match a working agent for an awaiting/waiting wait", () => {
    expect(
      agentMatchesUntil(activeWithAgent(claude("thinking")), awaitingOrWaiting),
    ).toBe(false);
  });

  it("matches a working agent for a working wait (the two-phase phase 1)", () => {
    const working = new Set(["working"]);
    expect(
      agentMatchesUntil(activeWithAgent(claude("tool_use")), working),
    ).toBe(true);
  });

  it("never matches a record with no live agent", () => {
    expect(agentMatchesUntil(activeWithAgent(null), awaitingOrWaiting)).toBe(
      false,
    );
    // A dormant record has no `.agent` at all.
    expect(
      agentMatchesUntil(
        { state: "parked" } as unknown as PadiTerminal,
        awaitingOrWaiting,
      ),
    ).toBe(false);
  });

  it("every WAIT_STATES bucket is a real agentBucket value (no dead target)", () => {
    expect(WAIT_STATES).toEqual(["working", "awaiting", "waiting"]);
  });
});

// ── The `match:` wait, over a fake attach feed ───────────────────────────────

/** One `terminalAttach` frame, as the fake feed pushes it — the member's own
 *  discriminated union at the width the watcher reads it. */
type AttachFrame =
  | { readonly kind: "delta"; readonly data: string }
  | {
      readonly kind: "snapshot";
      readonly data: string;
      readonly topLine: number;
    };

const delta = (data: string): AttachFrame => ({ kind: "delta", data });
const snapshot = (data: string): AttachFrame => ({
  kind: "snapshot",
  data,
  topLine: 0,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** A pushable frame SOURCE: every subscribe replays the queued frames from the
 *  start, waits for more, and ends on `end()` / fails on `fail()` — the contract
 *  a real member stream has. Same shape (and same deliberate omissions) as
 *  `read.test.ts`'s fake, plus the failure arm the retry-fence test needs.
 *
 *  {@link stream} hands back a LAZY `Stream` per call, like a real member ref, so
 *  `Stream.suspend` gives each subscribe its own replay cursor — which is exactly
 *  what a fence re-subscribe consumes.
 *
 *  The iterator deliberately exposes NO `return` method: `Stream.fromAsyncIterable`
 *  registers a teardown finalizer only when one exists and AWAITS what it resolves,
 *  and an iterator parked on an unsettled `next()` would never resolve it — hanging
 *  scope close instead of tearing down. Without the method an interrupt simply
 *  abandons the parked read, which is all a test needs. */
class FakeSource<T> {
  private readonly frames: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private ended = false;
  private failure: unknown;
  push(v: T): void {
    this.frames.push(v);
    this.wake();
  }
  end(): void {
    this.ended = true;
    this.wake();
  }
  /** End the stream in FAILURE — how a test spells a transport drop the fence is
   *  supposed to retry (`{_tag: "RpcClientError"}` is matched structurally by
   *  `shouldRetryStreamError`, so no rpc import is needed here). */
  fail(err: unknown): void {
    this.failure = err;
    this.ended = true;
    this.wake();
  }
  private wake(): void {
    for (const r of this.waiters.splice(0)) r();
  }
  stream(): Stream.Stream<T, unknown> {
    return Stream.suspend(() =>
      Stream.fromAsyncIterable<T, unknown>(this.iterable(), (e) => e),
    );
  }
  private iterable(): AsyncIterable<T> {
    let i = 0;
    const next = async (): Promise<IteratorResult<T, undefined>> => {
      while (true) {
        // In-range by the guard; the cast satisfies noUncheckedIndexedAccess.
        if (i < this.frames.length) {
          return { value: this.frames[i++] as T, done: false };
        }
        if (this.failure !== undefined) throw this.failure;
        if (this.ended) return { value: undefined, done: true };
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    };
    return { [Symbol.asyncIterator]: () => ({ next }) };
  }
}

/** A structural `PadiSurfaceClient` over exactly the three members the match wait
 *  touches: the attach feed, the exit event, and the `terminals` key set the
 *  lost-feed discrimination reads. Each verb hands back a `Stream` SYNCHRONOUSLY,
 *  the shape every member ref has under Effect.
 *
 *  `attach` is a FACTORY (not a stream): the retry fence re-runs the whole call on
 *  a retryable failure, so a test can hand the second subscription a different
 *  stream — which is how the reconnect case is spelled. */
function matchClient(parts: {
  attach: () => Stream.Stream<AttachFrame, unknown>;
  exit?: () => Stream.Stream<{ code: number }, unknown>;
  keys?: () => Stream.Stream<readonly TerminalId[], unknown>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminalAttach: { get: () => parts.attach() },
      // No exit event unless a test wires one: a live terminal's exit stream
      // simply never yields.
      terminalExit: { get: () => parts.exit?.() ?? Stream.never },
      terminals: {
        keys: () =>
          parts.keys?.() ??
          Stream.fail(
            new Error("terminals.keys must not be read in this case"),
          ),
      },
    },
  } as unknown as PadiSurfaceClient;
}

/** A `terminals.keys` snapshot that does NOT contain the watched terminal — the
 *  membership answer that turns a lost feed into `gone`. The cases below use it
 *  when they only need the wait to END so its verdict can be asserted. */
const keysWithout = (): Stream.Stream<readonly TerminalId[], unknown> =>
  Stream.make([] as readonly TerminalId[]);

const T = "t1";

describe("awaitOutputMatch — the `match:` wait over a fake attach feed", () => {
  it("matches a sentinel SPLIT across two deltas", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("running... SEN"));
    attach.push(delta("TINEL ok\n"));

    const outcome = await awaitOutputMatch(
      matchClient({ attach: () => attach.stream() }),
      { id: T, pattern: /SENTINEL/, timeoutMs: 5000 },
    );

    // The overlap carried from the first delta is what makes this a match at
    // all — the scan of the second delta alone would miss it.
    expect(outcome).toMatchObject({
      kind: "met",
      fired: "match",
      matchedLine: "running... SENTINEL ok",
    });
  });

  it("a match WINS over an already-latched terminalExit", async () => {
    const attach = new FakeSource<AttachFrame>();
    const exit = new FakeSource<{ code: number }>();
    // The exit event lands FIRST — the separately-ordered subscription the
    // sentinel's bytes are still in flight behind.
    exit.push({ code: 0 });

    const pending = awaitOutputMatch(
      matchClient({ attach: () => attach.stream(), exit: () => exit.stream() }),
      { id: T, pattern: /READY/, timeoutMs: 5000 },
    );
    // Give the exit subscription time to latch before any byte arrives.
    await sleep(50);
    attach.push(delta("READY\n"));

    // Latching (not settling) the exit is what keeps this `met`: a sentinel that
    // actually printed must not be reported as a terminal that vanished.
    expect(await pending).toMatchObject({ kind: "met", fired: "match" });
  });

  it("is `gone` when the exit latches and the feed ends with no match — without reading the key set", async () => {
    const attach = new FakeSource<AttachFrame>();
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 1 });
    attach.push(delta("nothing interesting here\n"));

    // No `keys` wired: an OBSERVED exit already answers the membership question,
    // so a read would fail the stream and settle `closed` instead — the failure
    // this case is watching for.
    const pending = awaitOutputMatch(
      matchClient({ attach: () => attach.stream(), exit: () => exit.stream() }),
      { id: T, pattern: /READY/, timeoutMs: 5000 },
    );
    await sleep(50);
    attach.end();

    expect(await pending).toMatchObject({ kind: "gone" });
  });

  it("RESETS the carry across a fence re-subscribe, so two halves cannot forge a sentinel", async () => {
    // The first subscription delivers half a sentinel, then drops with a
    // retryable transport failure; the fence clears the carry (`onFeedLost`)
    // and re-subscribes to a feed carrying the other half.
    const first = new FakeSource<AttachFrame>();
    first.push(delta("SEN"));
    first.fail({ _tag: "RpcClientError", message: "socket closed" });
    const second = new FakeSource<AttachFrame>();
    second.push(delta("TINEL\n"));
    second.end();

    let attempt = 0;
    const outcome = await awaitOutputMatch(
      matchClient({
        attach: () => (attempt++ === 0 ? first.stream() : second.stream()),
        keys: keysWithout,
      }),
      // No timeout: the fence's own ~1s retry delay must not race a deadline.
      { id: T, pattern: /SENTINEL/ },
    );

    // Bytes either side of a gap we could not observe are not one string.
    expect(outcome).toMatchObject({ kind: "gone" });
  }, 15_000);

  it("does NOT scan `snapshot` frames — only `delta`", async () => {
    const attach = new FakeSource<AttachFrame>();
    // The screen replay carries the marker, but it is old news: it was printed
    // before the wait was ever called.
    attach.push(snapshot("SENTINEL printed minutes ago\n"));
    attach.push(delta("still working\n"));
    attach.end();

    const outcome = await awaitOutputMatch(
      matchClient({ attach: () => attach.stream(), keys: keysWithout }),
      { id: T, pattern: /SENTINEL/, timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a /g pattern's lastIndex can neither cause a miss nor be mutated", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("READY now\n"));
    // A caller's `/g` RegExp carries state. `exec` would resume from here and
    // skip the sentinel entirely; `search` ignores it and puts it back.
    const pattern = /READY/g;
    pattern.lastIndex = 999;

    const outcome = await awaitOutputMatch(
      matchClient({ attach: () => attach.stream() }),
      { id: T, pattern, timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "met", matchedLine: "READY now" });
    expect(pattern.lastIndex).toBe(999);
  });

  it("scans a BOUNDED window — the overlap plus the new delta, never the history", async () => {
    // A RegExp that records what it was handed. `String.prototype.search`
    // dispatches through `@@search`, so this observes the exact scan width
    // without touching the watcher.
    class ScanSpy extends RegExp {
      readonly widths: number[] = [];
      override [Symbol.search](input: string): number {
        this.widths.push(input.length);
        return super[Symbol.search](input);
      }
    }
    const pattern = new ScanSpy("ZZZ");

    const attach = new FakeSource<AttachFrame>();
    const chunk = 1024;
    const frames = 40; // 40KiB of output — ten times the overlap.
    for (let i = 0; i < frames; i++) attach.push(delta("x".repeat(chunk)));
    attach.end();

    const outcome = await awaitOutputMatch(
      matchClient({ attach: () => attach.stream(), keys: keysWithout }),
      { id: T, pattern, timeoutMs: 20_000 },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
    // One scan per delta, each over MATCH_OVERLAP_CAP (4096 code units) + that
    // delta — flat, not growing with the 40KiB seen so far. A whole-window
    // re-scan would put 40960 here.
    expect(pattern.widths).toHaveLength(frames);
    expect(Math.max(...pattern.widths)).toBe(4096 + chunk);
  });

  it("keeps total scan cost proportional to the OUTPUT, not output × window", async () => {
    // `/a*Z/` never matches a run of `a`s, and costs O(n²) to fail over a
    // window of n — so the wall clock reads the scan width directly. Over
    // 48KiB delivered in 1KiB deltas: bounded windows (≤ 4096+1024) measure
    // ~0.9s on the dev box, while re-scanning the whole rolling buffer every
    // frame measures ~24s. The assertion sits between them with room for a
    // much slower machine. (A CATASTROPHIC pattern is a different animal — see
    // this file's header; no bound on the window rescues it.)
    const attach = new FakeSource<AttachFrame>();
    for (let i = 0; i < 48; i++) attach.push(delta("a".repeat(1024)));
    attach.end();

    const started = Date.now();
    const outcome = await awaitOutputMatch(
      matchClient({ attach: () => attach.stream(), keys: keysWithout }),
      { id: T, pattern: /a*Z/ },
    );
    const elapsed = Date.now() - started;

    expect(outcome).toMatchObject({ kind: "gone" });
    expect(elapsed).toBeLessThan(8000);
  }, 30_000);

  it("never cuts a surrogate pair in half when trimming the overlap", async () => {
    // The trim keeps the trailing 4096 UTF-16 CODE UNITS, and a naive slice can
    // land between an astral character's two halves — leaving an orphaned low
    // surrogate at the head of the next scan and a character no terminal
    // printed. Sized so the cut falls exactly on the low surrogate: the first
    // delta is 4097 units long with the emoji at index 0 of the kept tail.
    const emoji = "\u{1F600}"; // 2 code units
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("a" + emoji + "b".repeat(4095)));
    attach.push(delta("Z\n"));

    const outcome = await awaitOutputMatch(
      matchClient({ attach: () => attach.stream(), keys: keysWithout }),
      { id: T, pattern: new RegExp(`${emoji}b+Z`, "u"), timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "met", fired: "match" });
  });
});
