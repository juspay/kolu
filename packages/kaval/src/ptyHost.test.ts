import {
  ANSWERED_DEVICE_QUERIES,
  isTerminalQueryResponse,
  SILENT_DEVICE_QUERIES,
} from "@kolu/terminal-protocol";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { Effect, type Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeCompleteVt } from "@kolu/ghostty-kit";
import {
  answerDeviceQueries,
  createPtyHost,
  getScreenText,
  HEADLESS_TERM_ID,
  type PtyHost,
} from "./ptyHost.ts";
import { silentLogger as silentLog } from "@kolu/log/loggerStubs.testutil";
import { runScopedSync, subscribeFrames } from "./streamFrame.testlib.ts";

function linesBuffer(lines: string[]) {
  return {
    length: lines.length,
    getLine: (i: number) => {
      const line = lines[i];
      if (line === undefined) return undefined;
      return { translateToString: () => line };
    },
  };
}

describe("answerDeviceQueries", () => {
  it("replies DSR 6 with the engine cursor, not 1;1", () => {
    const got: string[] = [];
    answerDeviceQueries("\x1b[6n", (s) => got.push(s), { x: 7, y: 3 });
    expect(got).toEqual(["\x1b[4;8R"]);
  });

  it("answers a query split across leftover + suffix", () => {
    const first = takeCompleteVt("", "\x1b[6");
    expect(first.complete).toBe("");
    const second = takeCompleteVt(first.leftover, "n");
    const got: string[] = [];
    answerDeviceQueries(second.complete, (s) => got.push(s), { x: 2, y: 1 });
    expect(got).toEqual(["\x1b[2;3R"]);
  });
});

describe("getScreenText", () => {
  it("returns empty lines for a fresh terminal", () => {
    expect(getScreenText(linesBuffer(["", "", ""])).trim()).toBe("");
  });

  it("returns written text", () => {
    const text = getScreenText(linesBuffer(["hello world", "second line"]));
    expect(text).toContain("hello world");
    expect(text).toContain("second line");
  });

  it("respects startLine and endLine range", () => {
    const text = getScreenText(
      linesBuffer(["line0", "line1", "line2", "line3"]),
      1,
      3,
    );
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("line1");
    expect(lines[1]).toContain("line2");
  });

  it("clamps out-of-bounds range", () => {
    const text = getScreenText(linesBuffer(["only line"]), -5, 1000);
    expect(text).toContain("only line");
  });

  it("tailLines reads only the last N rendered lines", () => {
    const text = getScreenText(
      linesBuffer(["line0", "line1", "line2", "line3"]),
      undefined,
      4,
      2,
    );
    expect(text).not.toContain("line0");
    expect(text).not.toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("line3");
  });

  it("tailLines overrides startLine and clamps at 0", () => {
    const text = getScreenText(
      linesBuffer(["only line"]),
      999,
      undefined,
      1000,
    );
    expect(text).toContain("only line");
  });
});

// ── PTY host (real node-pty children) ──────────────────────────────────

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

/** First frame of a tap, with the subscription ESTABLISHED before this returns
 *  (`subscribeFrames` issues the first pull, which is the subscribe). */
async function firstEvent<T>(
  stream: Stream.Stream<T, unknown>,
  ms = 3000,
): Promise<T> {
  const frames = subscribeFrames(stream);
  try {
    return await frames.next(ms);
  } finally {
    frames.close();
  }
}

describeDaemon("createPtyHost", () => {
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

  it("viewport reads only the visible screen (the host's own rows)", async () => {
    host = createPtyHost({ log: silentLog });
    // A 10-row grid printing 30 lines: scrollback holds L01..L30, but the
    // visible screen is just the bottom screenful. `viewport` resolves to the
    // host's live `rows` — the CLI can't know it — so it drops the scrolled-off
    // top while a full read keeps it.
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "for i in $(seq 1 30); do printf 'L%02d\\n' $i; done; sleep 1",
      ],
      env: shellEnv,
      cwd: "/tmp",
      rows: 10,
      cols: 80,
    });
    await waitFor(() => host.getScreenText(id).includes("L30"));

    const full = host.getScreenText(id);
    expect(full).toContain("L01");
    expect(full).toContain("L30");

    // viewport (last `rows` = 10 lines) keeps the bottom of the buffer, never L01.
    const viewport = host.getScreenText(id, { kind: "viewport" });
    expect(viewport).toContain("L30");
    expect(viewport).not.toContain("L01");
  });

  it("delivers live output to attach() deltas", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'live delta\\n'; sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // The attachment's scope spans the whole read: closing it is what
    // unsubscribes, so the deltas stay live for as long as this body runs.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          let seen = "";
          // Drain chunks until the marker appears (or the stream stalls).
          while (!seen.includes("live delta"))
            seen += yield* Effect.promise(() => frames.next(2000));
          frames.close();
          expect(seen).toContain("live delta");
        }),
      ),
    );
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
    const { snapshot } = runScopedSync(host.attach(id));
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

  it("exit() succeeds with the child's exit code", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 7"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await Effect.runPromise(host.exit(id))).toBe(7);
  });

  it("still resolves the real exit code after the PTY is torn down", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(await Effect.runPromise(host.exit(id))).toBe(5);
    // Entry is gone from list() now, but a late query gets the real code
    // (the tombstone), not a fabricated 0.
    expect(host.list()).toHaveLength(0);
    expect(await Effect.runPromise(host.exit(id))).toBe(5);
  });

  it("exit for an id the tombstone no longer holds FAILS instead of fabricating 0 (K7)", async () => {
    // Past the tombstone cap (or never spawned at all) the host does not KNOW
    // the exit code. Answering `0` would be the caught-error→default shape this
    // repo bans in its most damaging spelling: a fabricated SUCCESS code that a
    // consumer reports to the user as "the command succeeded".
    host = createPtyHost({ log: silentLog });
    await expect(
      Effect.runPromise(host.exit("00000000-0000-0000-0000-000000000000")),
    ).rejects.toMatchObject({ _tag: "PtyNotFound" });
  });

  it("a PTY gone between the two liveness checks throws the TAGGED PtyNotFound (K6)", async () => {
    // The attach path checks liveness TWICE: the surface's `requirePtySync`
    // (typed `PtyNotFound`) and then, one Effect step later, `attach`'s own
    // `requireEntry`. A PTY that exits in the gap is a HEALTHY exit, and the
    // consumer (`padi`'s re-open loop) recognises it structurally by `_tag` — so
    // an untagged `Error` there turns a clean end into a spurious loud failure.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "exit 0"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // Check one passes — the PTY is live.
    expect(host.has(id)).toBe(true);
    // …and the exit lands in the gap.
    await Effect.runPromise(host.exit(id));
    await waitFor(() => !host.has(id));
    // Check two must speak the SAME vocabulary. `handle` is `requireEntry`'s
    // synchronous caller; `attach` is the one the gap is reachable through.
    let thrown: unknown;
    try {
      host.handle(id);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ _tag: "PtyNotFound", id });
    await expect(
      Effect.runPromise(Effect.scoped(host.attach(id))),
    ).rejects.toMatchObject({ _tag: "PtyNotFound" });
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
    // The tap hands back the retention AND the live marks in one step; here
    // nothing is retained yet, so the mark arrives live.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sub = yield* host.subscribeCommandRun(id);
          expect(sub.retained).toBeUndefined();
          expect(yield* Effect.promise(() => firstEvent(sub.marks))).toBe(
            "git status",
          );
        }),
      ),
    );
  });

  it("retains the last command line so a late reader catches up (getLastCommand)", async () => {
    // The retention `commandRun`'s snapshot-first source replays on subscribe:
    // a sensor attaching AFTER the OSC 633;E mark (e.g. a late/restarted pulam)
    // must still learn the command, so the agent isn't shown as a non-agent
    // `node`. A long-lived shell keeps the entry alive past the mark.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]633;E;codex\\033\\\\'; sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getLastCommand(id) === "codex");
    expect(host.getLastCommand(id)).toBe("codex");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  // ── R2: command-rooted PTYs (#1872 lock 1 — the argv is not discarded) ──

  it("seeds lastCommand from the argv for a command-rooted PTY", async () => {
    // A `kaval-tui create -- claude …` PTY has the agent as argv[0] and no
    // shell, so it never emits the OSC 633;E mark that is lastCommand's only
    // writer today. The daemon received the command line at spawn — it must not
    // discard it. RED before lock 1 (getLastCommand stays undefined).
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getLastCommand(id) === "/bin/sh -c 'sleep 5'");
    expect(host.getLastCommand(id)).toBe("/bin/sh -c 'sleep 5'");
    // The seed is shellJoin-format, so the commandRun snapshot reparses it with
    // shellSplit — tagged so a reconnect never guesses the dialect.
    expect(host.getLastCommandShellJoin(id)).toBe(true);
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  it("does not seed a title (the title tap is live-only, no snapshot replay)", async () => {
    // The seed is `lastCommand` ONLY: the commandRun source replays snapshot-first
    // (so a late padi sensor learns the command), but the title tap is live-only —
    // a seeded title would be erased by the foreground sensor's first sample, so we
    // deliberately don't seed one. The tile carries the foreground process name.
    host = createPtyHost({ log: silentLog });
    // Use `/bin/sh` as argv[0] (a guaranteed-present binary, not a real agent
    // executable that CI may lack / a dev machine would actually launch) — the
    // seed is driven by `commandRooted`, not by argv[0] being a real agent.
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 5"],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    // lastCommand is seeded; title is not.
    await waitFor(() => host.getLastCommand(id) === "/bin/sh -c 'sleep 5'");
    expect(host.getTitle(id)).toBe("");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
  });

  it("a live 633;E mark overrides the command-rooted seed (precedence)", async () => {
    // Seed writes first; a real shell command mark is the live last-writer.
    // (A pin, green today: the 633;E handler already wins whatever was there.)
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf '\\033]633;E;git status\\033\\\\'; sleep 0.5"],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getLastCommand(id) === "git status");
    expect(host.getLastCommand(id)).toBe("git status");
    // The 633 mark is a RAW shell line, so the dialect flips off the shellJoin
    // seed — the snapshot reparses this with string-argv, not shellSplit, even
    // though the terminal is command-rooted.
    expect(host.getLastCommandShellJoin(id)).toBe(false);
  });

  it("does NOT seed lastCommand for a shell-rooted PTY (regression guard)", async () => {
    // The default (shell) path is unchanged: lastCommand stays undefined until a
    // real 633;E mark — seeding every spawn would mislabel every shell terminal.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "sleep 0.5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // A beat for any (erroneous) seed to land; the shell emits no 633;E here.
    await new Promise((r) => setTimeout(r, 200));
    expect(host.getLastCommand(id)).toBeUndefined();
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

  it("samples foregroundPid from OUTPUT alone — no OSC hook needed", async () => {
    // A bare `kaval-tui create` terminal carries none of kolu's rc-hooks, so it
    // emits no OSC 0/2 title or 633;E command mark — the only two triggers for
    // the OSC samplers. Agent detection keys on `foregroundPid`, so the
    // foreground tap must still publish it; the output-driven fallback does. Here
    // the process only ever PRINTS (no OSC anywhere), yet its foregroundPid lands
    // on the tap — without the fallback this subscribe would never resolve.
    host = createPtyHost({ log: silentLog });
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "echo working; sleep 5"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // The non-interactive `sh -c` runs its commands in its own process group, so
    // the pty's foreground-group leader is the spawned shell itself. The tap's
    // `current` reading is taken at subscribe time — before the child has
    // claimed the tty it can still be undefined — so wait for the live sample
    // that carries it.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const sub = yield* host.subscribeForeground(id);
          const frames = subscribeFrames(sub.samples);
          const sample = yield* Effect.promise(() =>
            frames.until((s) => s.foregroundPid !== undefined, 3000),
          );
          frames.close();
          expect(sample.foregroundPid).toBe(pid);
        }),
      ),
    );
    host.kill(id);
    await Effect.runPromise(host.exit(id));
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
    expect(host.getScreenText(id, { kind: "tail", lines: 24 })).toContain(
      "TAILMARK",
    );
    // (c) a cold-attaching client repaints the recent output from the snapshot.
    expect(runScopedSync(host.attach(id)).snapshot).toContain("TAILMARK");
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
    // A non-interactive shell reads one line and prints an unmistakable reply.
    // Unlike the old interactive shell, `sh -c` loads no host rc files.
    const { id, pid } = host.spawn({
      shell: "/bin/sh",
      args: [
        "-c",
        "IFS= read -r line; printf 'received:%s\\n' \"$line\"; sleep 5",
      ],
      commandRooted: true,
      env: shellEnv,
      cwd: "/tmp",
    });
    expect(host.list()).toEqual([
      expect.objectContaining({ id, pid, cwd: "/tmp" }),
    ]);
    host.write(id, "kolu_write_ok\n");
    await waitFor(() =>
      host.getScreenText(id).includes("received:kolu_write_ok"),
    );
    expect(host.getScreenText(id)).toContain("received:kolu_write_ok");
    expect(host.getProcess(id)).toBeTypeOf("string");
    host.kill(id);
    await Effect.runPromise(host.exit(id));
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
    await Effect.runPromise(host.exit(id));
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
    await Effect.runPromise(host.exit(id));
  });

  it("announces a spawn on the inventory feed as `created`", async () => {
    host = createPtyHost({ log: silentLog });
    // Subscribe BEFORE spawning — the eager-subscribe contract means a spawn on
    // the very next line is captured, not raced away. This is the property a
    // consumer (kolu-server) leans on to never miss an out-of-band create.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const inv = yield* host.subscribeInventory();
          expect(inv.entries).toEqual([]);
          const frames = subscribeFrames(inv.deltas);
          const { id, pid } = host.spawn({
            shell: "/bin/sh",
            args: ["-c", "sleep 5"],
            env: shellEnv,
            cwd: "/tmp",
          });
          expect(yield* Effect.promise(() => frames.next(3000))).toEqual({
            kind: "created",
            entry: expect.objectContaining({ id, pid, cwd: "/tmp" }),
          });
          frames.close();
          host.kill(id);
          yield* host.exit(id);
        }),
      ),
    );
  });

  it("announces a teardown on the inventory feed as `exited`", async () => {
    host = createPtyHost({ log: silentLog });
    // Subscribe BEFORE spawning so neither delta can race the subscription:
    // a `/bin/sh -c 'exit 0'` would otherwise be free to exit (and publish its
    // `exited` to nobody — dropped, no replay) before a post-spawn subscribe
    // registers. Spawn a long-lived shell, consume its `created`, then KILL it
    // to make the `exited` deterministic.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const inv = yield* host.subscribeInventory();
          const frames = subscribeFrames(inv.deltas);
          const { id } = host.spawn({
            shell: "/bin/sh",
            args: ["-c", "sleep 5"],
            env: shellEnv,
            cwd: "/tmp",
          });
          expect(yield* Effect.promise(() => frames.next(3000))).toMatchObject({
            kind: "created",
          });
          host.kill(id);
          yield* host.exit(id);
          expect(yield* Effect.promise(() => frames.next(3000))).toEqual({
            kind: "exited",
            id,
          });
          frames.close();
        }),
      ),
    );
  });

  it("fans the inventory feed out to multiple independent subscribers", async () => {
    host = createPtyHost({ log: silentLog });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const a = subscribeFrames((yield* host.subscribeInventory()).deltas);
          const b = subscribeFrames((yield* host.subscribeInventory()).deltas);
          const { id } = host.spawn({
            shell: "/bin/sh",
            args: ["-c", "sleep 5"],
            env: shellEnv,
            cwd: "/tmp",
          });
          expect(yield* Effect.promise(() => a.next(3000))).toMatchObject({
            kind: "created",
          });
          expect(yield* Effect.promise(() => b.next(3000))).toMatchObject({
            kind: "created",
          });
          a.close();
          b.close();
          host.kill(id);
          yield* host.exit(id);
        }),
      ),
    );
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
describeDaemon("device-query contract — suppressed ⇄ answered pairing", () => {
  function repliesTo(query: string): string[] {
    const got: string[] = [];
    answerDeviceQueries(query, (s) => got.push(s));
    return got;
  }

  it("every reply the headless natively emits is a shape the client filter suppresses", () => {
    // The matrix is DATA in @kolu/terminal-protocol — this test executes it
    // against the shipped libghostty engine so the policy and implementation
    // can't drift.
    for (const { name, query } of ANSWERED_DEVICE_QUERIES) {
      const replies = repliesTo(query);
      expect(replies.length, `${name}: headless must answer`).toBeGreaterThan(
        0,
      );
      for (const reply of replies) {
        expect(
          isTerminalQueryResponse(reply),
          `${name}: reply ${JSON.stringify(reply)} must match the suppressed grammars`,
        ).toBe(true);
      }
    }
  });

  it("the hand-rolled XTVERSION reply is a shape the client filter suppresses", () => {
    // The one class the headless has no built-in answerer for — ptyHost's
    // CSI > q handler synthesizes the DCS reply (answered behaviorally in
    // "answers XTVERSION" above); this pins its shape to the filter grammar.
    expect(isTerminalQueryResponse(`\x1bP>|${HEADLESS_TERM_ID}\x1b\\`)).toBe(
      true,
    );
  });

  it("colour and window-report queries are uniformly silent — the headless answers none", () => {
    for (const { name, query } of SILENT_DEVICE_QUERIES) {
      const replies = repliesTo(query);
      expect(replies, `${name}: expected uniform silence`).toEqual([]);
    }
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
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { deltas } = yield* host.attach(id);
          const frames = subscribeFrames(deltas);
          let raw = "";
          while (!raw.includes("OSC_SENTINEL"))
            raw += yield* Effect.promise(() => frames.next(2500));
          frames.close();
          expect(raw).toContain("OSC_SENTINEL");
          expect(raw).not.toContain("rgb:");
        }),
      ),
    );
    host.dispose();
  });
});

// PR1 of the kaval-memory plan (docs/atlas/.../kaval-memory-architecture.mdx):
// a reconnect storm — a WebSocket disconnect that interrupts every in-flight
// attach and re-issues it — must not serialize the mirror N times. These guard
// the two defenses without bounding the snapshot (that's PR2, and would change
// what a reload restores): an attach on an already-interrupted fiber does ZERO
// work, and a burst of attaches within one publish-epoch shares a single
// serialize.
describeDaemon("attach() reconnect-storm defenses", () => {
  let host: PtyHost;

  // These tests count serialize() calls, so they settle on output via
  // getScreenText (a plain buffer read) rather than getScreenState (which now
  // shares the snapshot memo) — otherwise the settle poll would pre-populate
  // the memo and skew the count. The aborted test below deliberately differs.
  afterEach(() => {
    vi.restoreAllMocks();
    host?.dispose();
  });

  it("does zero work for an attach on an already-interrupted fiber", async () => {
    // The re-issued half of a reconnect storm, whose client has gone: the attach
    // must serialize nothing. Under the AbortSignal face this was an explicit
    // already-aborted fast path returning an empty snapshot; under interruption
    // it is structural — an interrupted fiber never reaches the attach at all —
    // so the pin is that the effect is issued and NOTHING happens.
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'abort marker\\n'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    // Settle real on-screen content, so a *live* attach would be non-empty.
    await waitFor(() => host.getScreenState(id).includes("abort marker"));

    const before = host.getScreenState(id);
    const exit = Effect.runSyncExit(
      Effect.scoped(
        Effect.flatMap(Effect.interrupt, () =>
          host.attach(id, { resizeTo: { cols: 37, rows: 11 } }),
        ),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(host.getScreenState(id)).toBe(before);
  });

  it("does not resize the shared PTY for an attach on an already-interrupted fiber", async () => {
    // `resizeTo` mutates state EVERY attached client can see — it SIGWINCHes the
    // child, reflows the shared mirror, and on a width change bumps the reflow
    // epoch that stales other clients' backfill cursors. A subscriber that is
    // already gone must not inflict that on everyone else. Without the guard a
    // re-issued reconnect-storm attach carrying a different grid silently
    // re-sizes a terminal nobody asked to resize.
    // A 60-column token: one unwrapped row at the spawned 100 columns, but two
    // rows once reflowed to 37 — so the mirror's own rendered text reports
    // whether a resize happened, with no test-only accessor to add.
    const wide = "W".repeat(60);
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", `printf '${wide}\\n'; sleep 1`],
      env: shellEnv,
      cwd: "/tmp",
      cols: 100,
      rows: 30,
    });
    await waitFor(() => host.getScreenText(id).includes(wide));

    Effect.runSyncExit(
      Effect.scoped(
        Effect.flatMap(Effect.interrupt, () =>
          host.attach(id, { resizeTo: { cols: 37, rows: 11 } }),
        ),
      ),
    );

    // Still one unwrapped row — the interrupted attach left the shared grid alone.
    expect(host.getScreenText(id)).toContain(wide);
  });

  it("coalesces a burst of attaches within one publish-epoch into one serialize", async () => {
    host = createPtyHost({ log: silentLog });
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'idle marker\\n'; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes("idle marker"));

    const snaps = Array.from(
      { length: 25 },
      () => runScopedSync(host.attach(id)).snapshot,
    );

    expect(new Set(snaps).size).toBe(1);
    for (const s of snaps) expect(s).toContain("idle marker");
  });

  it("re-serializes after new output ends the epoch (cache cleared on publish)", async () => {
    host = createPtyHost({ log: silentLog });
    // A long-lived shell reading commands from its stdin: each output chunk is
    // triggered by an explicit host.write(), NOT a timed printf. So the second
    // chunk lands strictly after the epoch-1 attaches — the "first arrived,
    // second not yet" boundary is test-controlled, never a race a slow CI
    // worker can lose by printing both before the first poll observes either.
    const { id } = host.spawn({
      shell: "/bin/sh",
      env: shellEnv,
      cwd: "/tmp",
    });
    host.write(id, "echo first\n");
    await waitFor(() => host.getScreenText(id).includes("first"));

    const first = runScopedSync(host.attach(id)).snapshot;
    const again = runScopedSync(host.attach(id)).snapshot;
    expect(again).toBe(first);

    host.write(id, "echo second\n");
    await waitFor(() => host.getScreenText(id).includes("second"));
    const { snapshot } = runScopedSync(host.attach(id));
    expect(snapshot).not.toBe(first);
    expect(snapshot).toContain("second");
  });

  it("re-serializes after a resize reflows the mirror (cache cleared on resize)", async () => {
    host = createPtyHost({ log: silentLog });
    // A 91-col marker line wraps at the default 80 cols and unwraps at 120, so
    // the resize reflows the serialized layout — and does so with NO data
    // publish, the path that exposes the missed invalidation.
    const { id } = host.spawn({
      shell: "/bin/sh",
      args: ["-c", "printf 'WIDEMARK%083d\\n' 0; sleep 1"],
      env: shellEnv,
      cwd: "/tmp",
    });
    await waitFor(() => host.getScreenText(id).includes("WIDEMARK"));

    const first = runScopedSync(host.attach(id)).snapshot;
    host.resize(id, 120, 24);
    const second = runScopedSync(host.attach(id)).snapshot;
    expect(second).not.toBe(first);
  });
});
