/**
 * `nixLogReader` against Nix's real `--log-format internal-json` output. Every
 * fixture line below was captured from nix 2.34 — a failing local build with a
 * dependent, a failing `ssh-ng://` build, an ssh connection failure, and an
 * evaluation error — with only the store hashes shortened.
 */
import { describe, expect, it, vi } from "vitest";
import { describeNixError, nixLogReader, runNix } from "./nixLog";
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
    expect(reader.sawTransportFailure()).toBe(false);
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

  it("an ssh connection failure is ssh's own raw line plus Nix's headline — both transport", () => {
    const { reader, narrated } = read([
      "ssh: connect to host 10.255.255.1 port 22: Connection timed out",
      `@nix {"action":"msg","column":null,"file":null,"level":0,"line":null,"msg":"${J}[31;1merror:${J}[0m failed to start SSH connection to '${J}[35;1m10.255.255.1${J}[0m'","raw_msg":"failed to start SSH connection to '${J}[35;1m10.255.255.1${J}[0m'"}`,
    ]);
    expect(reader.sawTransportFailure()).toBe(true);
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
});
