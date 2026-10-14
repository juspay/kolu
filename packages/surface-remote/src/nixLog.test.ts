/**
 * `nixLogReader` against Nix's real `--log-format internal-json` output. Every
 * fixture line below was captured from nix 2.34 — a failing local build with a
 * dependent, a failing `ssh-ng://` build, an ssh connection failure, and an
 * evaluation error — with only the store hashes shortened.
 */
import { describe, expect, it, vi } from "vitest";
import { shellQuoteArg } from "@kolu/shell-quote";
import {
  describeNixError,
  nixLogReader,
  nixRunCommand,
  runNix,
} from "./nixLog";
import { nixJsonLine } from "./nixLog.testutil";
import { runCapture } from "./process";

vi.mock("./process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./process")>()),
  runCapture: vi.fn(),
}));

const ESC = "\u001b";
/** How Nix spells ESC inside its JSON strings — a raw control character would
 *  not be valid JSON. */
const J = "\\u001b";
const BAD_DRV = "/nix/store/xqs3ly085bi005jp3mzzyzzbbjinpxwm-bad.drv";
const TOP_DRV = "/nix/store/h8gq9lyv31p928z8lqvwrdf2z7r8nriv-top.drv";

const failingBuildWithDependent = [
  `@nix {"action":"start","fields":["${BAD_DRV}","",1,1],"id":6779382538436617,"level":3,"parent":0,"text":"building '${BAD_DRV}'","type":105}`,
  `@nix {"action":"result","fields":["curl: Failed to connect to crates.io"],"id":6779382538436617,"type":101}`,
  `@nix {"action":"result","fields":["error: cannot download x from any mirror"],"id":6779382538436617,"type":101}`,
  `@nix {"action":"stop","id":6779382538436617}`,
  `@nix {"action":"msg","level":0,"msg":"${J}[31;1merror:${J}[0m Cannot build '${J}[35;1m${BAD_DRV}${J}[0m'.\\n       Reason: ${J}[31;1mbuilder failed with exit code 1${J}[0m.\\n       Output paths:\\n         ${J}[35;1m/nix/store/7ll5yah8zh42mvg1vh0rd45hi27q33wp-bad${J}[0m\\n       Last 2 log lines:\\n       > curl: Failed to connect to crates.io\\n       > error: cannot download x from any mirror"}`,
  `@nix {"action":"msg","column":null,"file":null,"level":0,"line":null,"msg":"${J}[31;1merror:${J}[0m Cannot build '${J}[35;1m${TOP_DRV}${J}[0m'.\\n       Reason: ${J}[31;1m1 dependency failed${J}[0m.","raw_msg":"Cannot build '${J}[35;1m${TOP_DRV}${J}[0m'.\\nReason: ${J}[31;1m1 dependency failed${J}[0m."}`,
];

function read(lines: readonly string[]) {
  const narrated: string[] = [];
  const reader = nixLogReader((l) => narrated.push(l));
  for (const l of lines) reader.line(l);
  return { reader, narrated };
}

describe("nixLogReader", () => {
  it("names the FIRST error, with the failed build's own last log lines as the why", () => {
    const { reader } = read(failingBuildWithDependent);
    const error = reader.rootError();
    expect(error).toEqual({
      headline: `Cannot build '${BAD_DRV}'.`,
      detail: [
        "curl: Failed to connect to crates.io",
        "error: cannot download x from any mirror",
      ],
    });
    expect(error && describeNixError(error)).toBe(
      `Cannot build '${BAD_DRV}'. — error: cannot download x from any mirror`,
    );
  });

  it("never reads a builder's log — or Nix quoting it — as a transport failure", () => {
    const { reader } = read(failingBuildWithDependent);
    expect(reader.nixReportedTransportFailure()).toBe(false);
    expect(reader.sshReportedTransportFailure()).toBe(false);
  });

  it("narrates the root error in full and the cascade one line each, without colour", () => {
    const { reader, narrated } = read(failingBuildWithDependent);
    expect(narrated[0]).toBe(`building '${BAD_DRV}'`);
    expect(narrated).toContain(`error: Cannot build '${BAD_DRV}'.`);
    expect(narrated.at(-1)).toBe(`error: Cannot build '${TOP_DRV}'.`);
    expect(narrated.some((l) => l.includes(ESC))).toBe(false);
    // Builder log lines are evidence for the failure, not live narration.
    expect(narrated).not.toContain("curl: Failed to connect to crates.io");
    // The cascade followed the root error, so the caller gets it to re-narrate last.
    expect(reader.recap()).toEqual([
      `error: Cannot build '${BAD_DRV}'.`,
      "curl: Failed to connect to crates.io",
      "error: cannot download x from any mirror",
    ]);
  });

  it("an ssh connection failure is ssh's own raw line — transport — plus Nix's headline", () => {
    const { reader, narrated } = read([
      "ssh: connect to host 10.255.255.1 port 22: Connection timed out",
      `@nix {"action":"msg","column":null,"file":null,"level":0,"line":null,"msg":"${J}[31;1merror:${J}[0m failed to start SSH connection to '${J}[35;1m10.255.255.1${J}[0m'","raw_msg":"failed to start SSH connection to '${J}[35;1m10.255.255.1${J}[0m'"}`,
    ]);
    expect(reader.sshReportedTransportFailure()).toBe(true);
    expect(narrated[0]).toBe(
      "ssh: connect to host 10.255.255.1 port 22: Connection timed out",
    );
    expect(reader.rootError()?.headline).toBe(
      "failed to start SSH connection to '10.255.255.1'",
    );
  });

  it("an evaluation error's headline is its own message, its detail the trace", () => {
    const { reader } = read([
      `@nix {"action":"msg","column":null,"file":null,"level":0,"line":null,"msg":"${J}[31;1merror:${J}[0m\\n       … while calling the '${J}[35;1mthrow${J}[0m' builtin\\n         ${J}[34;1mat ${J}[35;1m«string»:1:1${J}[0m:\\n            1| throw \\"boom\\"\\n             | ${J}[31;1m^${J}[0m\\n\\n       ${J}[31;1merror:${J}[0m boom","raw_msg":"boom"}`,
    ]);
    const error = reader.rootError();
    expect(error?.headline).toBe("boom");
    expect(error?.detail[0]).toBe("       … while calling the 'throw' builtin");
  });

  it("drops -v chatter above info level but narrates info messages", () => {
    const { narrated } = read([
      `@nix {"action":"msg","level":4,"msg":"evaluating file '/nix/store/x-source/default.nix'"}`,
      `@nix {"action":"start","id":1,"level":6,"parent":0,"text":"querying info about missing paths","type":0}`,
      `@nix {"action":"msg","level":3,"msg":"these 57 derivations will be built:"}`,
      `@nix {"action":"result","fields":[0,1,1,0],"id":1,"type":105}`,
    ]);
    expect(narrated).toEqual(["these 57 derivations will be built:"]);
  });

  it("no recap when the root error is already the last thing narrated", () => {
    const { reader } = read(failingBuildWithDependent.slice(0, 5));
    expect(reader.rootError()).not.toBeNull();
    expect(reader.recap()).toEqual([]);
  });

  it("surfaces a line that only claims to be a Nix event verbatim, never drops it", () => {
    const { narrated } = read(["@nix {not json"]);
    expect(narrated).toEqual(["@nix {not json"]);
  });

  it("still recognises a build-log result whose `type` field carries a space after the colon — the pre-filter is whitespace-tolerant, not a literal byte match", () => {
    const { reader } = read([
      `@nix {"action":"start","fields":["${BAD_DRV}","",1,1],"id":1,"level":3,"parent":0,"text":"building '${BAD_DRV}'","type":105}`,
      // Not Nix's own current spelling, but valid JSON all the same: the
      // pre-filter must not assume nlohmann::json's exact `dump()` byte output
      // is a protocol guarantee.
      `@nix {"action":"result","fields":["curl: Failed to connect to crates.io"],"id":1,"type": 101}`,
      `@nix {"action":"msg","level":0,"msg":"error: Cannot build '${BAD_DRV}'."}`,
    ]);
    expect(reader.rootError()?.detail).toEqual([
      "curl: Failed to connect to crates.io",
    ]);
  });
});

/** Nix's `resProgress` result for activity `id` at `done` of `expected` — the
 *  event curl's progress callback re-sends about once a second, moved or not. */
const progress = (id: number, done: number, expected = 1000): string =>
  nixJsonLine({
    action: "result",
    id,
    type: 105,
    fields: [done, expected, 1, 0],
  });

describe("nixLogReader.isActivity — progress counts, heartbeats do not", () => {
  it("a progress result whose `done` has not moved is not activity", () => {
    const reader = nixLogReader(() => {});
    expect(reader.isActivity(progress(9, 4096))).toBe(true);
    // The stalled transfer: the same counter, re-sent forever.
    for (let i = 0; i < 20; i++)
      expect(reader.isActivity(progress(9, 4096))).toBe(false);
  });

  it("an advancing `done` is activity, per activity id", () => {
    const reader = nixLogReader(() => {});
    expect(reader.isActivity(progress(9, 0))).toBe(true);
    expect(reader.isActivity(progress(9, 10))).toBe(true);
    // Another activity's first counter is its own news.
    expect(reader.isActivity(progress(11, 10))).toBe(true);
    expect(reader.isActivity(progress(9, 10))).toBe(false);
    expect(reader.isActivity(progress(9, 11))).toBe(true);
  });

  it("every other line stays activity — messages, activity starts and stops, other results, raw ssh text", () => {
    const reader = nixLogReader(() => {});
    reader.isActivity(progress(9, 1));
    for (const line of [
      ...failingBuildWithDependent,
      nixJsonLine({ action: "result", id: 9, type: 106, fields: [104, 1] }),
      nixJsonLine({ action: "msg", level: 4, msg: "evaluating file 'x'" }),
      "ssh: connect to host h port 22: Connection timed out",
    ])
      expect(reader.isActivity(line)).toBe(true);
  });
});

describe("runNix", () => {
  it("states a line bound far above the 64 KiB text default — a builder's long line must not kill the build", async () => {
    vi.mocked(runCapture).mockResolvedValue({
      ok: true,
      kind: "exit",
      code: 0,
      stdout: "",
    });
    await runNix("localhost", ["nix", "build"], {
      policy: { kind: "deadline", ms: 1000 },
      signal: undefined,
    });
    expect(
      vi.mocked(runCapture).mock.calls[0]?.[2].maxLineLength,
    ).toBeGreaterThan(64 * 1024);
  });

  /** One run at `target` whose stderr is `lines` and whose exit code is `code`. */
  const runAt = async (
    target: string,
    lines: readonly string[],
    code: number,
  ) => {
    vi.mocked(runCapture).mockImplementationOnce(async (_cmd, _args, opts) => {
      for (const l of lines) opts.onProgress?.(l);
      return { ok: false, kind: "exit", code, stdout: "" };
    });
    return runNix(target, ["nix-store", "--check-validity", "/nix/store/x"], {
      policy: { kind: "deadline", ms: 1000 },
      signal: undefined,
    });
  };
  const SSH_TIMEOUT = "ssh: connect to host h port 22: Connection timed out";
  const SSH_REFUSED = "u@h: Permission denied (publickey).";

  it("an ssh-wrapped 255 is transport only when ssh said why — never a bare 255", async () => {
    expect((await runAt("h", [], 255)).transportFailure).toBe(false);
    expect((await runAt("h", [SSH_TIMEOUT], 255)).transportFailure).toBe(true);
    expect((await runAt("h", [SSH_REFUSED], 255)).transportFailure).toBe(true);
  });

  it("an ssh-wrapped seat never reads text alone as transport — the remote command's stderr rides the same stream", async () => {
    expect((await runAt("h", [SSH_TIMEOUT], 1)).transportFailure).toBe(false);
  });

  it("on the local seat, the ssh Nix forked saying so is transport on its own", async () => {
    expect((await runAt("localhost", [SSH_TIMEOUT], 1)).transportFailure).toBe(
      true,
    );
    expect((await runAt("localhost", [], 1)).transportFailure).toBe(false);
  });

  it("on the local seat, a bare ssh REFUSAL is never trusted as transport — it needs exit-code corroboration the local seat cannot supply", async () => {
    // `runNix("localhost", …)` also evaluates a source flake and prefetches a
    // declared cache: the forked ssh (if any) is not provably the dial's
    // target host, so an unrelated credential rejection must not retry-forever
    // a permanent local config fault.
    expect((await runAt("localhost", [SSH_REFUSED], 1)).transportFailure).toBe(
      false,
    );
  });
});

describe("runNix on an ssh-wrapped seat — an abandoned run is killed on the host", () => {
  const PID_REPORT = "kolu-remote-pid 4242";
  const ok = { ok: true, kind: "exit", code: 0, stdout: "" } as const;

  it("wraps the remote Nix so it reports the PID it runs as; the local seat runs Nix bare", () => {
    const remote = nixRunCommand("h", ["nix-store", "-q", "/nix/store/x"]);
    expect(remote.command).toBe("ssh");
    const at = remote.args.indexOf("h");
    expect(remote.args.slice(at + 1)).toEqual(
      [
        "sh",
        "-c",
        'echo "kolu-remote-pid $$" >&2; exec "$@"',
        "sh",
        "nix-store",
        "--log-format",
        "internal-json",
        "-q",
        "/nix/store/x",
      ].map(shellQuoteArg),
    );
    expect(
      nixRunCommand("localhost", ["nix-store", "-q", "/nix/store/x"]),
    ).toEqual({
      command: "nix-store",
      args: ["--log-format", "internal-json", "-q", "/nix/store/x"],
    });
  });

  /** One remote run that reports `pid` and then ends as `end`; every later
   *  `runCapture` (the kill) answers `killResult`. */
  const remoteRun = (
    end: Awaited<ReturnType<typeof runCapture>>,
    killResult: Awaited<ReturnType<typeof runCapture>> = ok,
  ) => {
    vi.mocked(runCapture).mockReset();
    vi.mocked(runCapture)
      .mockImplementationOnce(async (_cmd, _args, opts) => {
        opts.isActivity?.(PID_REPORT);
        opts.onProgress?.(PID_REPORT);
        return end;
      })
      .mockResolvedValue(killResult);
    const narrated: string[] = [];
    const run = runNix("ci@croissant", ["nix", "copy", "/nix/store/x"], {
      policy: { kind: "progress-liveness", silenceMs: 1000 },
      onActivity: () => {},
      narrate: (l) => narrated.push(l),
      signal: undefined,
    });
    return { run, narrated };
  };
  const killCalls = () => vi.mocked(runCapture).mock.calls.slice(1);

  it.each([
    ["aborted", { ok: false, kind: "aborted", stdout: "" }],
    [
      "killed by its own silence bound",
      {
        ok: false,
        kind: "lifetime-expired",
        policy: { kind: "progress-liveness", silenceMs: 1000 },
        signal: "SIGTERM",
        stdout: "",
      },
    ],
  ] as const)("a run %s is SIGKILLed on the host by the PID it reported", async (_label, end) => {
    const { run, narrated } = remoteRun(end);
    await run;
    expect(killCalls()).toHaveLength(1);
    const [cmd, args] = killCalls()[0] ?? [];
    expect(cmd).toBe("ssh");
    expect(args?.slice(args.indexOf("ci@croissant") + 1)).toEqual(
      ["sh", "-c", 'kill -KILL "$1" 2>/dev/null; exit 0', "sh", "4242"].map(
        shellQuoteArg,
      ),
    );
    // Same dial options as the run itself — the same ControlMaster.
    const runArgs = vi.mocked(runCapture).mock.calls[0]?.[1] ?? [];
    expect(args?.slice(0, args.indexOf("ci@croissant"))).toEqual(
      runArgs.slice(0, runArgs.indexOf("ci@croissant")),
    );
    // The PID report is the wrapper's, never narrated as Nix's output.
    expect(narrated).not.toContain(PID_REPORT);
  });

  it("a run that exited on its own is never killed", async () => {
    await remoteRun({ ok: false, kind: "exit", code: 1, stdout: "" }).run;
    expect(killCalls()).toHaveLength(0);
    await remoteRun(ok).run;
    expect(killCalls()).toHaveLength(0);
  });

  it("a kill that cannot reach the host is narrated, never thrown", async () => {
    const { run, narrated } = remoteRun(
      { ok: false, kind: "aborted", stdout: "" },
      { ok: false, kind: "exit", code: 255, stdout: "" },
    );
    const res = await run;
    expect(res.kind).toBe("aborted");
    expect(narrated).toContain(
      "could not stop the abandoned nix on the host (pid 4242): exited with code 255",
    );
  });
});
