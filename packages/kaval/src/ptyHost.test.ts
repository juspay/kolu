import { createRequire } from "node:module";
import {
  ANSWERED_DEVICE_QUERIES,
  isTerminalQueryResponse,
  SILENT_DEVICE_QUERIES,
} from "@kolu/terminal-protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPtyHost,
  getScreenText,
  HEADLESS_TERM_ID,
  type PtyHost,
} from "./ptyHost.ts";

// @xterm packages ship CJS only — same interop as ptyHost.ts.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");

/** Write data to a terminal and wait for it to be processed. */
function writeAndFlush(
  term: InstanceType<typeof Terminal>,
  data: string,
): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

describe("getScreenText", () => {
  function createTerminal(
    opts: { cols?: number; rows?: number } = {},
  ): InstanceType<typeof Terminal> {
    return new Terminal({
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      allowProposedApi: true,
    });
  }

  it("returns empty lines for a fresh terminal", () => {
    const term = createTerminal({ rows: 3 });
    const text = getScreenText(term.buffer.active);
    expect(text.trim()).toBe("");
    term.dispose();
  });

  it("returns written text", async () => {
    const term = createTerminal();
    await writeAndFlush(term, "hello world\r\nsecond line\r\n");
    const text = getScreenText(term.buffer.active);
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
    term.dispose();
  });

  it("respects startLine and endLine range", async () => {
    const term = createTerminal({ rows: 10 });
    await writeAndFlush(term, "line0\r\nline1\r\nline2\r\nline3\r\n");
    const text = getScreenText(term.buffer.active, 1, 3);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");
    term.dispose();
  });

  it("clamps out-of-bounds range", async () => {
    const term = createTerminal({ rows: 5 });
    await writeAndFlush(term, "only line\r\n");
    const text = getScreenText(term.buffer.active, -5, 1000);
    expect(text).toContain("only line");
    term.dispose();
  });

  it("tailLines reads only the last N rendered lines", async () => {
    const term = createTerminal({ rows: 10 });
    await writeAndFlush(term, "line0\r\nline1\r\nline2\r\nline3\r\n");
    // Buffer has line0..line3 then blank rows; tail of 2 painted lines yields
    // the last two non-empty rows (and possibly trailing blanks), never line0/1.
    const text = getScreenText(term.buffer.active, undefined, 4, 2);
    expect(text).not.toContain("line0");
    expect(text).not.toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");
    term.dispose();
  });

  it("tailLines overrides startLine and clamps at 0", async () => {
    const term = createTerminal({ rows: 5 });
    await writeAndFlush(term, "only line\r\n");
    // A tail larger than the buffer just yields everything (start clamps to 0),
    // and the explicit startLine is ignored in favor of the tail.
    const text = getScreenText(term.buffer.active, 999, undefined, 1000);
    expect(text).toContain("only line");
    term.dispose();
  });
});

// ── PTY host (real node-pty children) ──────────────────────────────────

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A minimal env that lets `/bin/sh` find `sleep` etc. */
const shellEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  TERM: "xterm-256color",
};

async function waitFor(fn: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function firstEvent(
  iter: AsyncIterable<string>,
  ms = 3000,
): Promise<string> {
  const it = iter[Symbol.asyncIterator]();
  return raceNext(it, ms);
}

/** Pull the next value from an already-opened async iterator, failing the test
 *  on a timeout or a stream that ends before yielding. The generic sibling of
 *  `firstEvent` for iterators of any shape (e.g. the inventory feed). */
async function raceNext<T>(it: AsyncIterator<T>, ms = 3000): Promise<T> {
  const result = await Promise.race([
    it.next(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout waiting for event")), ms),
    ),
  ]);
  if (result.done) throw new Error("stream ended before any event");
  return result.value;
}

describe("createPtyHost", () => {
  let host: PtyHost;

  afterEach(() => {
    host?.dispose();
  });

  it("spawns a shell and mirrors its output", async () => {
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'hello mirror\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(pid).toBeGreaterThan(0);
    await waitFor(() => host.getScreenText(id).includes("hello mirror"));
    expect(host.getScreenText(id)).toContain("hello mirror");
  });

  it("delivers live output to attach() deltas", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'live delta\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    const { deltas } = host.attach(id);
    let seen = "";
    const it = deltas[Symbol.asyncIterator]();
    // Drain chunks until the marker appears (or the stream stalls).
    while (!seen.includes("live delta")) {
      const next = await Promise.race([
        it.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 2000),
        ),
      ]);
      if (next.done) break;
      seen += next.value;
    }
    expect(seen).toContain("live delta");
  });

  it("carries already-parsed output in the attach snapshot", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'snap content\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenState(id).includes("snap content"));
    const { snapshot } = host.attach(id);
    expect(snapshot).toContain("snap content");
  });

  it("keeps a wrapped URL on the cursor line intact across a narrowing resize", async () => {
    // A long URL printed WITHOUT a trailing newline leaves the cursor on the
    // wrapped line. xterm's reflow defaults to leaving the cursor's line alone
    // on a narrowing resize (then trims every row to the new width), which
    // truncates the overflow — a clicked web-link then opens a clipped address.
    // The headless terminal sets reflowCursorLine:true so the line rewraps and
    // the URL survives in the screen state a client restores on attach.
    const url =
      "https://example.com/path/to/a/really/long/resource?query=value&another=thing&more=stuff&x=12";
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      // The child must outlive the synchronous resize+read below: its exit
      // tears the entry down (disposes the headless terminal), after which
      // getScreenText returns "" and the assertion would fail for the wrong
      // reason. Sleep long enough to dwarf any scheduler stall — afterEach's
      // host.dispose() kills it the moment the test returns, so it never lingers.
      args: ["-c", `printf '%s' '${url}'; sleep 30`],
      env: shellEnv,
      cwd: "/tmp",
      cols: 80,
      rows: 24,
    });
    // Wait until the WHOLE (wrapped) URL has been parsed into the headless
    // screen. PTY output arrives in arbitrary chunks, so we join the wrapped
    // rows and wait for the full 92-char URL — not just an interior substring
    // that lands before the tail does — or the resize could fire on a
    // half-written URL and the final assertion would fail for the wrong reason.
    const joinedScreen = () => host.getScreenText(id).replace(/\n/g, "");
    await waitFor(() => joinedScreen().includes(url));
    // Narrow the grid: the URL was wrapped at 80 columns and must rewrap at 40.
    host.resize(id, 40, 24);
    // Joining the wrapped rows back together must still reproduce the whole URL;
    // a reflow that dropped the cursor line would leave a gap in the middle.
    expect(joinedScreen()).toContain(url);
  });

  it("resolves exitPromise with the child's exit code", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 7"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await host.exitPromise(id)).toBe(7);
  });

  it("still resolves the real exit code after the PTY is torn down", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await host.exitPromise(id)).toBe(5);
    // Entry is gone from list() now, but a late query gets the real code
    // (the tombstone), not a fabricated 0.
    expect(host.list()).toHaveLength(0);
    expect(await host.exitPromise(id)).toBe(5);
  });

  it("publishes cwd on OSC 7", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf '\\033]7;file://localhost/tmp/host-osc7\\033\\\\'; sleep 0.5",
      ],
      env: shellEnv,
      cwd: "/tmp",
    });
    const cwd = await firstEvent(host.subscribeCwd(id));
    expect(cwd).toBe("/tmp/host-osc7");
    expect(host.getCwd(id)).toBe("/tmp/host-osc7");
  });

  it("publishes the exact command line on OSC 633;E", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]633;E;git status\\033\\\\'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await firstEvent(host.subscribeCommandRun(id))).toBe("git status");
  });

  it("publishes title changes on OSC 0/2", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]2;my title\\033\\\\'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await firstEvent(host.subscribeTitle(id))).toBe("my title");
  });

  it("trims the headless mirror to its configured scrollback under heavy output", async () => {
    // The per-terminal mirror is what accumulates in kaval's heap, so it must
    // honour the (small) spawn scrollback: FIRSTLINE drops, LASTLINE stays, and
    // the buffer is bounded — not the full 400+ lines. See kaval-heap-oom.mdx.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf 'FIRSTLINE\\n'; for i in $(seq 1 400); do printf 'fill%s\\n' \"$i\"; done; printf 'LASTLINE\\n'; sleep 30",
      ],
      env: shellEnv,
      cwd: "/tmp",
      rows: 24,
      scrollback: 50,
    });
    await waitFor(() => host.getScreenText(id).includes("LASTLINE"));
    const text = host.getScreenText(id);
    expect(text).toContain("LASTLINE");
    expect(text).not.toContain("FIRSTLINE");
    expect(text.split("\n").length).toBeLessThan(120);
  });

  it("still serves the live jobs at a small mirror (metadata, scrape tail, cold-attach repaint)", async () => {
    // Shrinking the mirror must NOT starve the jobs that read it: the OSC
    // metadata taps are parse-time callbacks (depth-independent), and the
    // scrape tail + cold-attach snapshot only need the visible screen — all
    // still work when output far exceeds the tiny scrollback.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "printf '\\033]7;file://localhost/tmp/deep\\033\\\\'; for i in $(seq 1 400); do printf 'fill%s\\n' \"$i\"; done; printf 'TAILMARK\\n'; sleep 30",
      ],
      env: shellEnv,
      cwd: "/tmp",
      rows: 24,
      scrollback: 50,
    });
    // (a) metadata: OSC 7 cwd is parsed regardless of mirror depth.
    await waitFor(() => host.getCwd(id) === "/tmp/deep");
    expect(host.getCwd(id)).toBe("/tmp/deep");
    // (b) screen-scrape tail still reads the recent screen.
    await waitFor(() => host.getScreenText(id).includes("TAILMARK"));
    expect(host.getScreenText(id, undefined, undefined, 24)).toContain(
      "TAILMARK",
    );
    // (c) a cold-attaching client repaints the recent output from the snapshot.
    expect(host.attach(id).snapshot).toContain("TAILMARK");
  });

  it("answers XTVERSION (CSI > q) so a querying child is unblocked", async () => {
    host = createPtyHost({ log: silentLog });
    // Emit the XTVERSION query (CSI > 0 q) and idle. The headless handler writes
    // the DCS reply (`ESC P > | xterm-headless(kolu) ESC \\`) to the child's
    // PTY; the cooked TTY echoes that input straight back into the mirror, so
    // the model string appearing on screen proves the child received the reply.
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033[>0q'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes(HEADLESS_TERM_ID));
    expect(host.getScreenText(id)).toContain(HEADLESS_TERM_ID);
  });

  it("consumes XTVERSION with Ps > 0 without writing a reply", async () => {
    host = createPtyHost({ log: silentLog });
    // CSI > 1 q is not a version request; the handler consumes it but must NOT
    // synthesize a DCS reply. A SENTINEL printed after the query gives the
    // mirror something to settle on, after which the model string must be
    // absent — proving no reply was written (and thus nothing echoed back).
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033[>1qSENTINEL_DONE'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes("SENTINEL_DONE"));
    expect(host.getScreenText(id)).not.toContain(HEADLESS_TERM_ID);
  });

  it("routes write() to the child and lists live PTYs", async () => {
    host = createPtyHost({ log: silentLog });
    // A long-lived shell reading commands from its stdin (the PTY): a
    // written `echo` command runs and prints the marker — robust to whether
    // the tty echoes input.
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.list()).toEqual([
      expect.objectContaining({ id, pid, cwd: "/tmp" }),
    ]);
    host.write(id, "echo kolu_write_ok\n");
    await waitFor(() => host.getScreenText(id).includes("kolu_write_ok"));
    expect(host.getScreenText(id)).toContain("kolu_write_ok");
    expect(host.getProcess(id)).toBeTypeOf("string");
    host.kill(id);
    await host.exitPromise(id);
  });

  it("removes the PTY from list() after kill", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.list()).toHaveLength(1);
    host.kill(id);
    await host.exitPromise(id);
    expect(host.list()).toHaveLength(0);
  });

  it("vends a per-PTY handle that delegates to the host", async () => {
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    const handle = host.handle(id);
    expect(handle.pid).toBe(pid);
    expect(handle.cwd).toBe("/tmp");
    expect(typeof handle.process).toBe("string");
    host.kill(id);
    await host.exitPromise(id);
  });

  it("announces a spawn on the inventory feed as `created`", async () => {
    host = createPtyHost({ log: silentLog });
    // Subscribe BEFORE spawning — the eager-subscribe contract means a spawn on
    // the very next line is captured, not raced away. This is the property a
    // consumer (kolu-server) leans on to never miss an out-of-band create.
    const inv = host.subscribeInventory()[Symbol.asyncIterator]();
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    const ev = await raceNext(inv);
    expect(ev).toEqual({
      kind: "created",
      entry: expect.objectContaining({ id, pid, cwd: "/tmp" }),
    });
    host.kill(id);
    await host.exitPromise(id);
  });

  it("announces a teardown on the inventory feed as `exited`", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 0"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // Subscribe after the spawn but before exit — the `created` for this PTY was
    // published before we subscribed (dropped on the floor, no subscriber yet),
    // so the first event this subscriber sees is the `exited`.
    const inv = host.subscribeInventory()[Symbol.asyncIterator]();
    await host.exitPromise(id);
    expect(await raceNext(inv)).toEqual({ kind: "exited", id });
  });

  it("fans the inventory feed out to multiple independent subscribers", async () => {
    host = createPtyHost({ log: silentLog });
    const a = host.subscribeInventory()[Symbol.asyncIterator]();
    const b = host.subscribeInventory()[Symbol.asyncIterator]();
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await raceNext(a)).toMatchObject({ kind: "created" });
    expect(await raceNext(b)).toMatchObject({ kind: "created" });
    host.kill(id);
    await host.exitPromise(id);
  });
});

/**
 * The device-query contract — the executable form of the invariant that was
 * previously prose-only on both sides ("client-suppressed ⇒ server-answered",
 * `@kolu/terminal-protocol` (responseFilter) ⇄ the answerer/forwarder here).
 *
 * Every query class the client filter suppresses is in exactly one of two
 * deliberate states, and these tests pin the full table so drift on either
 * side (an xterm upgrade changing what the headless answers; a new suppressed
 * class added to the filter) breaks loudly instead of hanging a TUI silently:
 *
 *   1. ANSWERED — the headless answers it (natively, or via the hand-rolled
 *      XTVERSION handler) and the reply is forwarded to the child. Suppressing
 *      the mirroring client's duplicate is then safe: exactly one answerer.
 *   2. UNIFORMLY SILENT — NOBODY answers through kolu (the headless doesn't
 *      synthesize it, the forwarder drops `ESC ]` regardless, and the client
 *      filter suppresses the browser's theme-derived answer). Programs
 *      querying these (colour reports, window geometry) carry their own
 *      timeout fallbacks; consistent silence beats per-client divergence.
 */
describe("device-query contract — suppressed ⇄ answered pairing", () => {
  function freshHeadless(): InstanceType<typeof Terminal> {
    return new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  }

  async function repliesTo(
    term: InstanceType<typeof Terminal>,
    query: string,
  ): Promise<string[]> {
    const got: string[] = [];
    const sub = term.onData((d: string) => got.push(d));
    await writeAndFlush(term, query);
    sub.dispose();
    return got;
  }

  it("every reply the headless natively emits is a shape the client filter suppresses", async () => {
    const term = freshHeadless();
    // The matrix is DATA in @kolu/terminal-protocol — this test executes it
    // against a real headless so the policy and implementation can't drift.
    for (const { name, query } of ANSWERED_DEVICE_QUERIES) {
      const replies = await repliesTo(term, query);
      expect(replies.length, `${name}: headless must answer`).toBeGreaterThan(
        0,
      );
      for (const reply of replies) {
        // The pairing itself: the server's own answer is exactly the shape
        // the client filter drops — so the duplicate-drop can never eat a
        // reply the headless wouldn't have produced itself.
        expect(
          isTerminalQueryResponse(reply),
          `${name}: reply ${JSON.stringify(reply)} must match the suppressed grammars`,
        ).toBe(true);
      }
    }
    term.dispose();
  });

  it("the hand-rolled XTVERSION reply is a shape the client filter suppresses", () => {
    // The one class the headless has no built-in answerer for — ptyHost's
    // CSI > q handler synthesizes the DCS reply (answered behaviorally in
    // "answers XTVERSION" above); this pins its shape to the filter grammar.
    expect(isTerminalQueryResponse(`\x1bP>|${HEADLESS_TERM_ID}\x1b\\`)).toBe(
      true,
    );
  });

  it("colour and window-report queries are uniformly silent — the headless answers none", async () => {
    // The filter suppresses the BROWSER's answers to these (it has a theme
    // and a window; the headless has neither), keeping kolu's two clients
    // consistent with the headless's silence: through kolu, nobody answers,
    // and the querying program's own timeout fallback kicks in. If an xterm
    // upgrade starts answering any of these, this pin fails → re-audit the
    // forwarder's `ESC ]` drop and the filter comments together.
    const term = freshHeadless();
    for (const { name, query } of SILENT_DEVICE_QUERIES) {
      const replies = await repliesTo(term, query);
      expect(replies, `${name}: expected uniform silence`).toEqual([]);
    }
    term.dispose();
  });

  it("a colour query through a real PTY yields silence, never reply garbage", async () => {
    // End-to-end form of the same contract, covering the forwarder's
    // `startsWith("\\x1b]")` drop guard: even if the headless ever emitted an
    // OSC reply, it must not reach the child (where the cooked tty would echo
    // it back as visible escape soup — the original yazi-bug class). The
    // child's raw output (attach deltas, echo included) must never contain a
    // colour REPLY (`rgb:`), only the query the child itself printed.
    const host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]11;?\\007'; printf 'OSC_SENTINEL'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    const { deltas } = host.attach(id);
    let raw = "";
    const it = deltas[Symbol.asyncIterator]();
    while (!raw.includes("OSC_SENTINEL")) {
      const next = await Promise.race([
        it.next(),
        new Promise<IteratorResult<string>>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 2500),
        ),
      ]);
      if (next.done) break;
      raw += next.value;
    }
    expect(raw).toContain("OSC_SENTINEL");
    expect(raw).not.toContain("rgb:");
    host.dispose();
  });
});
