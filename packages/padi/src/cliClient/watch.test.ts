/**
 * The watch kit's PURE tests — no socket, no daemon. Two halves:
 *
 *   - the wait predicate over a composed record (`matchingActiveAgent`), moved
 *     here (verbatim fixtures) from padi-tui's `render.test.ts` when it
 *     graduated into the dial kit's watch module;
 *   - the `match:` wait (the engine with a match condition — what `kolu wait`
 *     runs) over a hand-rolled fake `PadiSurfaceClient` — the same
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
 * either hang or pass vacuously. See `awaitTerminalCondition`'s header, which names the
 * residual.
 */
import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PadiSurfaceClient } from "../dial.ts";
import { TerminalNotFound } from "../errors.ts";
import type { PadiTerminal } from "../surface.ts";
import {
  awaitAgentState,
  awaitOutputSettled,
  awaitTerminalCondition,
  matchingActiveAgent,
  WAIT_STATES,
} from "./watch.ts";

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

// Asserted on `matchingActiveAgent` — the predicate `awaitAgentState` actually
// calls — rather than on the boolean wrapper that used to sit in front of it:
// the wrapper had no production caller anywhere, and the agent this returns IS
// the `met` outcome's payload, so pinning the identity is strictly more than
// pinning `true`.
describe("matchingActiveAgent — the wait predicate over a composed record", () => {
  const awaitingOrWaiting = new Set(["awaiting", "waiting"]);

  it("returns the very agent whose bucket is in the targets", () => {
    const awaiting = claude("awaiting_user");
    expect(
      matchingActiveAgent(activeWithAgent(awaiting), awaitingOrWaiting),
    ).toBe(awaiting);
    const waiting = claude("waiting");
    expect(
      matchingActiveAgent(activeWithAgent(waiting), awaitingOrWaiting),
    ).toBe(waiting);
  });

  it("does NOT match a working agent for an awaiting/waiting wait", () => {
    expect(
      matchingActiveAgent(
        activeWithAgent(claude("thinking")),
        awaitingOrWaiting,
      ),
    ).toBeNull();
  });

  it("matches a working agent for a working wait (the two-phase phase 1)", () => {
    const working = new Set(["working"]);
    const toolUse = claude("tool_use");
    expect(matchingActiveAgent(activeWithAgent(toolUse), working)).toBe(
      toolUse,
    );
  });

  it("never matches a record with no live agent", () => {
    expect(
      matchingActiveAgent(activeWithAgent(null), awaitingOrWaiting),
    ).toBeNull();
    // A dormant record has no `.agent` at all.
    expect(
      matchingActiveAgent(
        { state: "parked" } as unknown as PadiTerminal,
        awaitingOrWaiting,
      ),
    ).toBeNull();
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
  attach?: () => Stream.Stream<AttachFrame, unknown>;
  exit?: () => Stream.Stream<{ code: number }, unknown>;
  keys?: () => Stream.Stream<readonly TerminalId[], unknown>;
  /** The `terminals` COLLECTION values the mirror replays — only the agent
   *  condition subscribes them. */
  get?: (key: TerminalId) => Stream.Stream<PadiTerminal, unknown>;
  /** `screen.text`, the read `screenTail` stamps a met with. */
  screenText?: () => Effect.Effect<string, unknown>;
}): PadiSurfaceClient {
  return {
    surface: {
      terminalAttach: {
        get: () =>
          parts.attach?.() ??
          Stream.fail(
            new Error("terminalAttach must not be subscribed in this case"),
          ),
      },
      // No exit event unless a test wires one: a live terminal's exit stream
      // simply never yields.
      terminalExit: { get: () => parts.exit?.() ?? Stream.never },
      terminals: {
        keys: () =>
          parts.keys?.() ??
          Stream.fail(
            new Error("terminals.keys must not be read in this case"),
          ),
        get: (input: { key: TerminalId }) =>
          parts.get?.(input.key) ??
          Stream.fail(new Error("terminals.get must not be read in this case")),
      },
      screen: {
        text: () =>
          parts.screenText?.() ??
          Effect.fail(new Error("screen.text must not be read in this case")),
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

/** The `match:` wait as PRODUCTION spells it — the engine with a match
 *  condition and no modifiers, which is exactly what `kolu wait --until
 *  match:<regex>` calls. There is no `awaitOutputMatch` wrapper to test through:
 *  a named wrapper with only a test caller would be public dial surface with no
 *  production caller (see `watch.ts`'s note at the foot of the named waits), so
 *  the shorthand lives here, in the only place that wanted one. */
const matchWait = (
  client: PadiSurfaceClient,
  opts: { id: string; pattern: RegExp; timeoutMs?: number },
) =>
  awaitTerminalCondition(client, {
    id: opts.id,
    condition: { kind: "match", pattern: opts.pattern },
    ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
    retryAdvice: "re-run the match wait",
  });

describe("the `match:` wait over a fake attach feed", () => {
  it("matches a sentinel SPLIT across two deltas", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("running... SEN"));
    attach.push(delta("TINEL ok\n"));

    const outcome = await matchWait(
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

    const pending = matchWait(
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
    const pending = matchWait(
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
    const outcome = await matchWait(
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

    const outcome = await matchWait(
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

    const outcome = await matchWait(
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

    const outcome = await matchWait(
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
    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream(), keys: keysWithout }),
      { id: T, pattern: /a*Z/ },
    );
    const elapsed = Date.now() - started;

    expect(outcome).toMatchObject({ kind: "gone" });
    expect(elapsed).toBeLessThan(8000);
  }, 30_000);

  it("a LATCHED match stops scanning — a later line never overwrites the one that fired", async () => {
    // The latch is what keeps `matchedLine` honest, and nothing else pinned it:
    // deleting the guard was green across the whole file until this case, which
    // is why it is here (kolu#2152). Scanning on would re-derive the line from a
    // carry frozen at the match plus bytes that arrived much later — reporting a
    // line the sentinel did not fire on, and in general splicing two
    // non-adjacent stretches of output into a line no terminal ever printed.
    //
    // A conjunct is what makes the hazard observable at all: without one the met
    // settles on the first match and no later delta is ever seen.
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta("first MARK here\n"));
    attach.push(delta("second MARK there\n"));

    const outcome = await awaitTerminalCondition(
      matchClient({ attach: () => attach.stream() }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /MARK/ },
        settledMs: 80,
        timeoutMs: 5000,
        retryAdvice: "re-run the match wait",
      },
    );

    // The line that FIRED, not the last one that would have.
    expect(outcome).toMatchObject({
      kind: "met",
      fired: "match",
      matchedLine: "first MARK here",
    });
  });

  it("never cuts a surrogate pair in half when trimming the overlap", async () => {
    // The trim keeps the trailing 4096 UTF-16 CODE UNITS, and a naive slice can
    // land between an astral character's two halves — leaving an orphaned low
    // surrogate at the head of the next scan and a character no terminal
    // printed. Sized so the cut falls exactly on the low surrogate: the first
    // delta is 4097 units long with the emoji at index 0 of the kept tail.
    const emoji = "\u{1F600}"; // 2 code units
    const attach = new FakeSource<AttachFrame>();
    attach.push(delta(`a${emoji}${"b".repeat(4095)}`));
    attach.push(delta("Z\n"));

    const outcome = await matchWait(
      matchClient({ attach: () => attach.stream(), keys: keysWithout }),
      { id: T, pattern: new RegExp(`${emoji}b+Z`, "u"), timeoutMs: 5000 },
    );

    expect(outcome).toMatchObject({ kind: "met", fired: "match" });
  });
});

// ── The two modifiers: the `--settled` conjunct and the `--snapshot` stamp ────
//
// These are the kolu#2139 flags, and what each pins is a way a driving loop gets
// LIED TO. `--settled` exists because "the agent's bucket says waiting" is not
// "the agent is done" — a main loop that ends its turn while an async subagent
// runs reads as `waiting` within milliseconds, and the field incident was an
// orchestrator nudging a worker three minutes into a deliberate plan. So the
// conjunct's promise is not "it usually waits a bit longer": it is that bytes
// moving KEEP THE WAIT OPEN and a bucket that stops matching RE-ENTERS it.
// `--snapshot`'s promise is narrower and just as easy to lose: the screen on a
// met is one taken during the same unbroken stretch of quiet that met the
// condition — never one the terminal moved under while it was being read.

/** A `terminals` collection that starts with `first` and can be pushed to — the
 *  agent condition's feed. `keys` yields the watched id once and then stays
 *  live, which is what a real subscription does. */
function agentCollection(first: AgentInfo | null): {
  readonly parts: {
    keys: () => Stream.Stream<readonly TerminalId[], unknown>;
    get: (key: TerminalId) => Stream.Stream<PadiTerminal, unknown>;
  };
  readonly push: (agent: AgentInfo | null) => void;
} {
  const values = new FakeSource<PadiTerminal>();
  values.push(activeWithAgent(first));
  return {
    parts: {
      keys: () =>
        Stream.concat(
          Stream.make([T as TerminalId] as readonly TerminalId[]),
          Stream.never,
        ),
      get: () => values.stream(),
    },
    push: (agent) => values.push(activeWithAgent(agent)),
  };
}

describe("awaitTerminalCondition — `--settled`, the quiescence conjunct", () => {
  it("keeps the wait OPEN while bytes move, though the bucket already matches", async () => {
    // The exact field failure: the agent's main loop ended its turn (bucket
    // `waiting` on the FIRST frame, so the condition holds immediately) while a
    // subagent keeps printing. Without the conjunct this is a met at t≈0.
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const noise = setInterval(() => attach.push(delta("·")), 10);
    try {
      const outcome = await awaitTerminalCondition(
        matchClient({ attach: () => attach.stream(), ...agents.parts }),
        {
          id: T as TerminalId,
          condition: {
            kind: "agent",
            targets: new Set(["awaiting", "waiting"]),
          },
          settledMs: 300,
          timeoutMs: 400,
          retryAdvice: "re-run the wait",
        },
      );
      expect(outcome).toMatchObject({ kind: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });

  it("settles the moment the SAME wait sees its quiet window through", async () => {
    // No second call, no re-arm: the conjunct is evaluated on the subscription
    // the condition is, which is the whole race the three-call loop could not
    // close from outside.
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    let ticks = 0;
    const noise = setInterval(() => {
      if (++ticks > 5) {
        clearInterval(noise);
        return;
      }
      attach.push(delta("·"));
    }, 10);

    const outcome = await awaitTerminalCondition(
      matchClient({ attach: () => attach.stream(), ...agents.parts }),
      {
        id: T as TerminalId,
        condition: { kind: "agent", targets: new Set(["awaiting", "waiting"]) },
        settledMs: 80,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    clearInterval(noise);
    expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
    // It waited for the quiet, not merely for the bucket: the noise ran ~50ms
    // and the window is 80ms on top of the last byte.
    if (outcome.kind !== "met") throw new Error("unreachable");
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(80);
  });

  it("RE-ENTERS the wait when the bucket drops back to working", async () => {
    // A quiet terminal whose agent picks the work back up is not done, and a
    // conjunct that latched the condition would report the first quiet moment
    // as a met — the same lie in a different shape.
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));

    const pending = awaitTerminalCondition(
      matchClient({ attach: () => attach.stream(), ...agents.parts }),
      {
        id: T as TerminalId,
        condition: { kind: "agent", targets: new Set(["awaiting", "waiting"]) },
        settledMs: 60,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    // Back to work before the window elapses — nothing may settle now, however
    // quiet the terminal gets.
    agents.push(claude("thinking"));
    await sleep(200);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await sleep(0);
    expect(settled).toBe(false);

    // Genuinely finished this time.
    agents.push(claude("awaiting_user"));
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
  });

  it("opens NO attach feed for an agent condition with no conjunct", async () => {
    // The plain agent-state wait must cost exactly what it always cost: this
    // client FAILS a `terminalAttach` subscription, so a feed opened for a wait
    // that has no quiescence to measure would surface as a `closed` outcome.
    const agents = agentCollection(claude("waiting"));
    const outcome = await awaitTerminalCondition(matchClient(agents.parts), {
      id: T as TerminalId,
      condition: { kind: "agent", targets: new Set(["waiting"]) },
      timeoutMs: 5000,
      retryAdvice: "re-run the wait",
    });
    expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
  });
});

describe("awaitTerminalCondition — `captureScreen`, the screen stamp", () => {
  const screen = "prompt$ run\nall 12 passed\n\n\n\n";

  it("stamps the met with the terminal's rendered screen, whole", async () => {
    // The engine captures; BOUNDING the capture is the face's decision (`kolu
    // wait --snapshot N` slices with `tailLines`), and it is not even a wire
    // saving — the read passes no line range, so the buffer already crossed.
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () => Effect.succeed(screen),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        captureScreen: true,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );
    expect(outcome).toMatchObject({ kind: "met", fired: "idle", screen });
  });

  it("DISCARDS a screen the terminal moved under, and stamps the next quiet one", async () => {
    // The property a second `kolu snapshot` process can never have: the screen
    // on a met was taken during the same unbroken stretch of quiet that met the
    // condition. Here the first read is held open while a delta lands.
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    let release: (() => void) | undefined;
    const reads: string[] = [];
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () =>
          Effect.promise(async () => {
            if (reads.length === 0) {
              reads.push("stale");
              // Move the terminal under the read, then let it resolve.
              await new Promise<void>((resolve) => {
                release = resolve;
                attach.push(delta("late output\n"));
                setTimeout(resolve, 0);
              });
              return "STALE\n";
            }
            reads.push("fresh");
            return "FRESH\n";
          }),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        settledMs: 40,
        captureScreen: true,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );
    release?.();

    expect(reads).toEqual(["stale", "fresh"]);
    expect(outcome).toMatchObject({ kind: "met", screen: "FRESH\n" });
  });

  it("reports `gone` when the terminal ends between the condition and the read", async () => {
    // Never a `closed`: `closed` tells its reader to retry, and there is nothing
    // left to retry against a terminal that no longer exists.
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () => Effect.fail(new TerminalNotFound({ id: T })),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 40 },
        captureScreen: true,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );
    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("DISCARDS a screen whose quiet window re-fired under it — not just one whose flags flipped", async () => {
    // The subtle version of the same bug, and the one a boolean re-check cannot
    // see: the read outlives its quiescence window, so by the time it resolves
    // the window has re-armed AND re-fired. `held` and `quiet` both read `true`
    // again — the flags say yes — but they are a DIFFERENT met's flags, and the
    // screen in hand was taken during the previous quiet stretch, before a
    // screenful of output the terminal has since printed. Only comparing the
    // moment (the epoch counter) catches it.
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const reads: string[] = [];
    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        screenText: () =>
          Effect.promise(async () => {
            if (reads.length === 0) {
              reads.push("stale");
              // Break the quiet, then let the window re-fire — all while this
              // read is still in flight.
              attach.push(delta("a screenful of late output\n"));
              await sleep(80);
              return "STALE\n";
            }
            reads.push("fresh");
            return "FRESH\n";
          }),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "idle", idleMs: 20 },
        settledMs: 20,
        captureScreen: true,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(reads).toEqual(["stale", "fresh"]);
    expect(outcome).toMatchObject({ kind: "met", screen: "FRESH\n" });
  });

  it("CONVERGES on a chattering terminal whose candidate cannot fall back — exactly one read", async () => {
    // THE fixed-point pin, and the defect both structural lenses raised
    // independently. `match:` + a capture and NO conjunct is the configuration
    // that can loop: the feed is open (the scan needs it), `held` LATCHES on the
    // sentinel, and `quiet` is permanently satisfied — so a generation bumped by
    // every FRAME rather than by every candidate CHANGE invalidates a read that
    // nothing can ever make valid. One `screen.text` round-trip per discard, for
    // as long as the terminal keeps printing, against a `--timeout` the caller
    // need not even have passed.
    //
    // Here the terminal chatters for the whole duration of the read. Exactly one
    // read must happen, because none of those bytes can change this candidate.
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    let reads = 0;
    let chatter: ReturnType<typeof setInterval> | undefined;
    try {
      const outcome = await awaitTerminalCondition(
        matchClient({
          attach: () => attach.stream(),
          keys: keysWithout,
          screenText: () =>
            Effect.promise(async () => {
              reads += 1;
              // Keep bytes moving across the whole round-trip.
              chatter = setInterval(() => attach.push(delta("·")), 5);
              await sleep(60);
              clearInterval(chatter);
              return "READY\n";
            }),
        }),
        {
          id: T as TerminalId,
          condition: { kind: "match", pattern: /DONE/ },
          captureScreen: true,
          timeoutMs: 3000,
          retryAdvice: "re-run the wait",
        },
      );
      expect(outcome).toMatchObject({
        kind: "met",
        fired: "match",
        screen: "READY\n",
      });
      expect(reads).toBe(1);
    } finally {
      if (chatter !== undefined) clearInterval(chatter);
    }
  });

  it("CONVERGES while the roster re-publishes an unchanged agent — exactly one read", async () => {
    // The same missing fixed point, reached through the OTHER subscription. The
    // `terminals` mirror re-publishes a record for any awareness refresh (a git
    // poll, a PR check, a foreground sample), and most leave the agent exactly
    // where it was. Counting each as a candidate change would invalidate every
    // in-flight read with nothing to re-earn — one `screen.text` per refresh,
    // for the life of the wait.
    const agents = agentCollection(claude("waiting"));
    let reads = 0;
    let churn: ReturnType<typeof setInterval> | undefined;
    try {
      const outcome = await awaitTerminalCondition(
        matchClient({
          ...agents.parts,
          screenText: () =>
            Effect.promise(async () => {
              reads += 1;
              // Re-publish the SAME agent throughout the round-trip.
              churn = setInterval(() => agents.push(claude("waiting")), 5);
              await sleep(60);
              clearInterval(churn);
              return "READY\n";
            }),
        }),
        {
          id: T as TerminalId,
          condition: {
            kind: "agent",
            targets: new Set(["awaiting", "waiting"]),
          },
          captureScreen: true,
          timeoutMs: 3000,
          retryAdvice: "re-run the wait",
        },
      );
      expect(outcome).toMatchObject({ kind: "met", fired: "agent" });
      expect(reads).toBe(1);
    } finally {
      if (churn !== undefined) clearInterval(churn);
    }
  });

  it("a latched `match` + a conjunct is MET on the terminal's EXIT, not `gone`", async () => {
    // `echo DONE; exit` is the ordinary sentinel shape: the sentinel prints, the
    // process exits, the ordered feed ends. Together those are proof no byte can
    // ever arrive again — the strongest form of the quiet `--settled` asks for —
    // so adding the conjunct must not convert this exit-0 into a terminal-died
    // exit-3 that no input could ever satisfy.
    //
    // The exit event is pushed FIRST on purpose: it rides its own subscription
    // and really can be delivered before the delta carrying the sentinel, which
    // is why the claim cannot hang off `onExit`.
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 0 });
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    attach.end();

    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        exit: () => exit.stream(),
        keys: keysWithout,
      }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /DONE/ },
        settledMs: 60_000,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(outcome).toMatchObject({
      kind: "met",
      fired: "match",
      matchedLine: "DONE",
    });
  });

  it("the same wait WITH a capture is `gone` — a dead terminal has no screen", async () => {
    // The honest boundary of the arm above, and DETERMINISTIC on purpose.
    // padi's `screen.text` narrows to an ACTIVE terminal, so once the PTY is
    // gone there is no screen to read and no met carrying one can exist.
    // Claiming the conjunct anyway would start a read the `gone` settle
    // immediately aborts — the same outcome, reached by a race. So the claim is
    // not made at all when a capture was asked for: the sentinel printed, but
    // the screen died with the terminal.
    const exit = new FakeSource<{ code: number }>();
    exit.push({ code: 0 });
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    attach.end();

    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        exit: () => exit.stream(),
        keys: keysWithout,
        // Reading it would be the bug; a real padi answers TerminalNotFound.
        screenText: () => Effect.fail(new TerminalNotFound({ id: T })),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /DONE/ },
        settledMs: 60_000,
        captureScreen: true,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(outcome).toMatchObject({ kind: "gone" });
  });

  it("a LIVE terminal's dropped feed is `closed` — a lost feed never mints a met", async () => {
    // The blocking hole the peer review found in the first version of the arm
    // above: `onFeedLost` fires BEFORE the spine has told a `gone` terminal from
    // a `closed` one, so claiming quiet there let a still-running terminal whose
    // feed merely dropped settle `met`. A lost feed is evidence we cannot SEE
    // the terminal — the opposite of evidence that it is quiet.
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    attach.push(delta("DONE\n"));
    attach.end();

    const outcome = await awaitTerminalCondition(
      matchClient({
        attach: () => attach.stream(),
        // No exit event, and the terminal is STILL IN the key set: the feed
        // dropped under a live terminal.
        keys: () => Stream.make([T] as readonly TerminalId[]),
      }),
      {
        id: T as TerminalId,
        condition: { kind: "match", pattern: /DONE/ },
        settledMs: 60_000,
        timeoutMs: 5000,
        retryAdvice: "re-run the wait",
      },
    );

    expect(outcome).toMatchObject({ kind: "closed" });
  });
});

// ── The two named waits — the modifiers reach the MCP face THROUGH them ───────
//
// `wait_agentState` / `wait_outputSettled` call these wrappers rather than the
// engine, so that the met frames those tools document have exactly one owner
// (kolu#2152). Two things can silently break as a result and neither shows up
// in the engine's own pins: a modifier the wrapper forgets to forward (the tool
// advertises an option that does nothing), and a key the wrapper lets through
// onto a published wire.
describe("awaitAgentState / awaitOutputSettled — forwarding, and the wire frames", () => {
  const screen = "prompt$ run\nall 12 passed\n\n\n\n";

  it("forwards `settledMs` — bytes still moving keep an already-matching bucket open", async () => {
    // The kolu#2139 failure, reached through the wrapper: the agent's bucket is
    // `waiting` on the FIRST frame while a subagent keeps printing. Unforwarded,
    // this is a met at t≈0 — which is what the MCP face used to report.
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const noise = setInterval(() => attach.push(delta("·")), 10);
    try {
      const outcome = await awaitAgentState(
        matchClient({ attach: () => attach.stream(), ...agents.parts }),
        {
          id: T as TerminalId,
          targets: new Set(["awaiting", "waiting"]),
          settledMs: 300,
          timeoutMs: 400,
        },
      );
      expect(outcome).toMatchObject({ kind: "timeout" });
    } finally {
      clearInterval(noise);
    }
  });

  it("forwards `captureScreen`, and the met frame gains `screen` WITHOUT gaining `fired`", async () => {
    // `met: {agent, elapsedMs}` is `wait_agentState`'s documented frame. The
    // engine's own met carries a `fired` tag; letting it through here would put
    // it on that wire. `screen` is additive — a reader that never asks for one
    // sees the frame it always saw.
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitAgentState(
      matchClient({
        attach: () => attach.stream(),
        screenText: () => Effect.succeed(screen),
        ...agents.parts,
      }),
      {
        id: T as TerminalId,
        targets: new Set(["awaiting", "waiting"]),
        captureScreen: true,
        timeoutMs: 5000,
      },
    );
    expect(outcome).toMatchObject({ kind: "met", agent: claude("waiting") });
    expect(outcome).toHaveProperty("screen", screen);
    expect(outcome).not.toHaveProperty("fired");
  });

  it("a met with no capture asked for carries NO `screen` key at all", async () => {
    // Absent, not `undefined`: the key rides a JSON wire, and an explicit
    // `"screen": null`/undefined would read to a driving agent as "the screen
    // was captured and there was nothing there".
    const agents = agentCollection(claude("waiting"));
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitAgentState(
      matchClient({ attach: () => attach.stream(), ...agents.parts }),
      {
        id: T as TerminalId,
        targets: new Set(["awaiting", "waiting"]),
        timeoutMs: 5000,
      },
    );
    expect(outcome).toMatchObject({ kind: "met" });
    expect(Object.keys(outcome)).not.toContain("screen");
  });

  it("awaitOutputSettled forwards `captureScreen` — the whole buffer, for the face to bound", async () => {
    const attach = new FakeSource<AttachFrame>();
    attach.push(snapshot("worker\n"));
    const outcome = await awaitOutputSettled(
      matchClient({
        attach: () => attach.stream(),
        screenText: () => Effect.succeed(screen),
      }),
      { id: T, idleMs: 40, captureScreen: true, timeoutMs: 5000 },
    );
    expect(outcome).toMatchObject({ kind: "met", fired: "idle", screen });
  });
});
