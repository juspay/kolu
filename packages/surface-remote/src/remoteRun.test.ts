/** `runCaptureAt` — the one-shot runner that places a command on a host. Its own
 *  rule: an ABANDONED remote run (aborted / killed by its lifetime policy) is
 *  SIGKILLed on the host by the PID the wrapper reported. `runCapture` is mocked:
 *  the argv shapes and the kill call are the contract; no live host is needed. */
import { shellQuoteArg } from "@kolu/shell-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CaptureResult, runCapture } from "./process";
import { captureAtCommand, runCaptureAt } from "./remoteRun";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const HOST = "ci@croissant";
const PID_REPORT = "surface-remote-pid 4242";
const ok: CaptureResult = { ok: true, kind: "exit", code: 0, stdout: "" };
const aborted: CaptureResult = { ok: false, kind: "aborted", stdout: "" };

beforeEach(() => vi.mocked(runCapture).mockReset());

describe("captureAtCommand", () => {
  it("wraps a remote command so it reports the PID it then runs as", () => {
    const { command, args } = captureAtCommand(HOST, [
      "nix-store",
      "-q",
      "a b",
    ]);
    expect(command).toBe("ssh");
    expect(args.slice(args.indexOf(HOST) + 1)).toEqual(
      [
        "sh",
        "-c",
        'echo "surface-remote-pid $$" >&2; exec "$@"',
        "sh",
        "nix-store",
        "-q",
        "a b",
      ].map(shellQuoteArg),
    );
  });

  it("runs a local command bare — the local group-kill already reaches it", () => {
    expect(captureAtCommand("localhost", ["nix-store", "-q", "x"])).toEqual({
      command: "nix-store",
      args: ["-q", "x"],
    });
  });
});

describe("runCaptureAt — an abandoned remote run is killed on the host", () => {
  /** A run at `target` whose stderr is the PID report then `lines`, ending as `end`;
   *  every later `runCapture` (the kill) answers `killResult`. */
  const run = (
    target: string,
    end: CaptureResult,
    lines: readonly string[] = [],
    killResult: CaptureResult = ok,
  ) => {
    vi.mocked(runCapture)
      .mockImplementationOnce(async (_cmd, _args, opts) => {
        for (const l of [PID_REPORT, ...lines]) {
          opts.isActivity?.(l);
          opts.onProgress?.(l);
        }
        return end;
      })
      .mockResolvedValue(killResult);
    const seen: string[] = [];
    const failures: string[] = [];
    const result = runCaptureAt(target, ["nix", "copy", "/nix/store/x"], {
      policy: { kind: "progress-liveness", silenceMs: 1000 },
      isActivity: () => true,
      onProgress: (l) => seen.push(l),
      onRemoteKillFailure: (m) => failures.push(m),
    });
    return { result, seen, failures };
  };
  const kills = () => vi.mocked(runCapture).mock.calls.slice(1);

  it.each([
    ["aborted", aborted],
    [
      "killed by its own lifetime policy",
      {
        ok: false,
        kind: "lifetime-expired",
        policy: { kind: "progress-liveness", silenceMs: 1000 },
        signal: "SIGTERM",
        stdout: "",
      } as const,
    ],
  ])("a run %s is SIGKILLed by its PID, over the same dial options", async (_l, end) => {
    const { result, seen } = run(HOST, end, ["copying path 'x'"]);
    expect(await result).toBe(end);
    expect(kills()).toHaveLength(1);
    const [cmd, args = []] = kills()[0] ?? [];
    expect(cmd).toBe("ssh");
    expect(args.slice(args.indexOf(HOST) + 1)).toEqual(
      ["sh", "-c", 'kill -KILL "$1" 2>/dev/null; exit 0', "sh", "4242"].map(
        shellQuoteArg,
      ),
    );
    const runArgs = vi.mocked(runCapture).mock.calls[0]?.[1] ?? [];
    expect(args.slice(0, args.indexOf(HOST))).toEqual(
      runArgs.slice(0, runArgs.indexOf(HOST)),
    );
    // The wrapper's report is never the command's own output.
    expect(seen).toEqual(["copying path 'x'"]);
  });

  it("a run that ended on its own is never killed", async () => {
    await run(HOST, { ok: false, kind: "exit", code: 1, stdout: "" }).result;
    await run(HOST, ok).result;
    expect(vi.mocked(runCapture).mock.calls).toHaveLength(2);
  });

  it("a local run is never remote-killed — and a PID-shaped line is just output there", async () => {
    const { result, seen } = run("localhost", aborted);
    await result;
    expect(kills()).toHaveLength(0);
    expect(seen).toEqual([PID_REPORT]);
  });

  it("a kill that cannot reach the host is reported to the caller, never thrown", async () => {
    const { result, failures } = run(HOST, aborted, [], {
      ok: false,
      kind: "exit",
      code: 255,
      stdout: "",
    });
    expect((await result).kind).toBe("aborted");
    expect(failures).toEqual([
      "could not stop the abandoned 'nix' on the host (pid 4242): exited with code 255",
    ]);
  });
});
