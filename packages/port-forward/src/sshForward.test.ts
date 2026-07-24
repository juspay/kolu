import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PortUnavailableError } from "./portChoice.ts";
import {
  forwardCommandArgs,
  forwardSpec,
  openSshAttempt,
  plainDiagnostic,
  reportsBindFailure,
  SSH_OPTS,
  type SpawnSsh,
} from "./sshForward.ts";

/** A stand-in for the real options prefix, so these stay about the argv. */
const base = ["-o", "BatchMode=yes", "-o", "ControlPath=none"] as const;

describe("forwardSpec", () => {
  it("binds the local end on ALL interfaces", () => {
    // `*:` is the whole reason a browser on another machine can reach this;
    // a loopback bind here would make the forward useless.
    expect(forwardSpec({ localPort: 4123, remotePort: 4123 })).toBe(
      "*:4123:127.0.0.1:4123",
    );
  });

  it("points the far end at the target host's own loopback", () => {
    expect(forwardSpec({ localPort: 1, remotePort: 65535 })).toBe(
      "*:1:127.0.0.1:65535",
    );
  });
});

describe("forwardCommandArgs", () => {
  const args = forwardCommandArgs({
    base,
    host: "pu-dev",
    localPort: 61000,
    remotePort: 5173,
  });

  it("opens the tunnel on its own connection", () => {
    expect(args).toEqual([
      ...base,
      "-L",
      "*:61000:127.0.0.1:5173",
      "pu-dev",
      "echo PORT-FORWARD-READY; cat",
    ]);
  });

  it("ends in a command that dies with our end of the pipe", () => {
    // NOT `-N`: measured on a live sshd, an `ssh -N -L` child SURVIVES its
    // parent's SIGKILL and keeps serving the port. A remote command reading a
    // pipe we hold gets EOF the instant the kernel closes our fds, which is
    // what makes the forward's lifetime the process's lifetime.
    expect(args).not.toContain("-N");
    expect(args.at(-1)).toMatch(/cat$/);
  });

  it("announces readiness from the far end, not from the port", () => {
    // ssh establishes forwardings BEFORE running the remote command, so the
    // token is proof that OUR tunnel is up. A "can something answer on this
    // port?" probe proved only that SOMETHING answered.
    expect(args.at(-1)).toContain("echo PORT-FORWARD-READY");
  });

  it("puts the host after every option and before the command", () => {
    expect(args.indexOf("pu-dev")).toBeGreaterThan(args.indexOf("-L"));
    expect(args.indexOf("pu-dev")).toBe(args.length - 2);
  });
});

describe("reportsBindFailure", () => {
  it("sees ssh's own bind error", () => {
    expect(
      reportsBindFailure("bind [0.0.0.0]:4123: Address already in use"),
    ).toBe(true);
  });

  it("sees a refusal on any line, not just the first", () => {
    expect(
      reportsBindFailure(
        "debug1: connecting\nCould not request local forwarding.",
      ),
    ).toBe(true);
  });

  it("cannot be spoofed by the far end mid-line", () => {
    // The remote command's stderr is merged into this same stream. Both
    // branches are anchored to a line start, so a remote cannot steer our
    // forward onto a different port by printing ssh's words inside its output.
    expect(
      reportsBindFailure("remote: Could not request local forwarding (ha)"),
    ).toBe(false);
    expect(reportsBindFailure("please rebind [0.0.0.0]:1 later")).toBe(false);
  });

  it("says nothing about a healthy forward", () => {
    expect(reportsBindFailure("")).toBe(false);
    expect(reportsBindFailure("Warning: Permanently added 'pu-dev'")).toBe(
      false,
    );
  });
});

/** A stand-in for the ssh child, so the decisions BRAIDED around one — the
 *  readiness token, the bind-failure line, exit-before-ready vs after — can be
 *  driven from a test instead of from a live sshd. */
class FakeSsh extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: Array<NodeJS.Signals | undefined> = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }

  /** ssh ending, however it ended. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  says(text: string): Promise<void> {
    this.stdout.write(text);
    return flush();
  }

  complains(text: string): Promise<void> {
    this.stderr.write(text);
    return flush();
  }
}

/** Let the stream's `data` handlers run. */
function flush(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}

function attempt(fake: FakeSsh, onLost: (reason: string) => void = () => {}) {
  const spawnSsh: SpawnSsh = () =>
    fake as unknown as ChildProcessWithoutNullStreams;
  return openSshAttempt({
    host: "pu-dev",
    remotePort: 5173,
    localPort: 4123,
    onLost,
    spawnSsh,
  });
}

describe("one ssh forward attempt", () => {
  it("is up when the FAR END announces itself", async () => {
    const fake = new FakeSsh();
    const opening = attempt(fake);
    await fake.says("PORT-FORWARD-READY\n");

    await expect(opening).resolves.toMatchObject({ localPort: 4123 });
  });

  it("remembers a bind failure the far end tried to flood out of view", async () => {
    // The diagnostic buffer keeps only a tail. The far end writes to this same
    // stream, so it could otherwise push the bind line past the window with a
    // few kilobytes of noise and have the ready token resolve a half-bound
    // forward. The FACT is latched; only the text is truncated.
    const fake = new FakeSsh();
    const opening = attempt(fake);
    await fake.complains("bind [0.0.0.0]:4123: Address already in use\n");
    await fake.complains(`${"noise from the far end\n".repeat(400)}`);
    await fake.says("PORT-FORWARD-READY\n");

    await expect(opening).rejects.toThrow(PortUnavailableError);
  });

  it("is NOT up when ssh bound only half the port", async () => {
    // `*:` asks for both address families; a taken v4 with a free v6 leaves ssh
    // running the remote command as if all were well. Half a listener is the
    // row that lies, so the attempt takes another port instead.
    const fake = new FakeSsh();
    const settled = expect(attempt(fake)).rejects.toThrow(PortUnavailableError);
    await fake.complains("bind [0.0.0.0]:4123: Address already in use\n");
    await fake.says("PORT-FORWARD-READY\n");

    await settled;
  });

  it("reports a port that could not be bound as the caller's cue to take another", async () => {
    const fake = new FakeSsh();
    const opening = attempt(fake);
    await fake.complains("bind [0.0.0.0]:4123: Address already in use\n");
    fake.exit(255);

    await expect(opening).rejects.toThrow(PortUnavailableError);
  });

  it("carries ssh's own words when it dies before it was ever up", async () => {
    const fake = new FakeSsh();
    const opening = attempt(fake);
    await fake.complains("Host key verification failed.\n");
    fake.exit(255);

    await expect(opening).rejects.toThrow(/Host key verification failed/);
  });

  it("calls onLost exactly once when the connection dies after it was up", async () => {
    const onLost = vi.fn<(reason: string) => void>();
    const fake = new FakeSsh();
    const opening = attempt(fake, onLost);
    await fake.says("PORT-FORWARD-READY\n");
    await opening;

    fake.exit(null, "SIGHUP");

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onLost.mock.calls[0]?.[0]).toMatch(/connection to pu-dev ended/);
  });

  it("does NOT call onLost for a forward we closed ourselves", async () => {
    // `close()` is already telling the caller the forward is gone; reporting it
    // again as a LOSS would put an error on screen for a cancel that worked.
    const onLost = vi.fn<(reason: string) => void>();
    const fake = new FakeSsh();
    const opening = attempt(fake, onLost);
    await fake.says("PORT-FORWARD-READY\n");
    const forward = await opening;

    const closing = forward.close();
    fake.exit(null, "SIGTERM");
    await closing;

    expect(onLost).not.toHaveBeenCalled();
  });
});

describe("the argv's preconditions", () => {
  // These are not style: each one is a behaviour the mechanism's guarantees
  // rest on, and every one of them is settable in a per-host ssh_config stanza
  // for exactly the aliases this library invites people to use.
  const args = forwardCommandArgs({
    base: SSH_OPTS,
    host: "pu-dev",
    localPort: 4123,
    remotePort: 5173,
  });
  const opt = (name: string): string | undefined =>
    args.find((a) => a.startsWith(`${name}=`));

  it("keeps ssh talking, so a bind failure cannot be silenced by config", () => {
    expect(opt("LogLevel")).toBe("LogLevel=ERROR");
  });

  it("keeps stdin a live pipe, so the hold-open command is not handed EOF", () => {
    expect(opt("StdinNull")).toBe("StdinNull=no");
  });

  it("refuses a PTY, so the far end cannot drive our terminal", () => {
    expect(opt("RequestTTY")).toBe("RequestTTY=no");
  });

  it("refuses to background, so the forward's life stays this process's life", () => {
    expect(opt("ForkAfterAuthentication")).toBe("ForkAfterAuthentication=no");
  });
});

describe("plainDiagnostic", () => {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);

  it("keeps ssh's actual words", () => {
    expect(plainDiagnostic("bind [0.0.0.0]:4123: Address already in use")).toBe(
      "bind [0.0.0.0]:4123: Address already in use",
    );
  });

  it("strips colour the far end used to rewrite what the operator reads", () => {
    expect(plainDiagnostic(`${ESC}[31mall fine${ESC}[0m`)).toBe("all fine");
  });

  it("strips an OSC 8 hyperlink the far end tried to inject", () => {
    const attack = `${ESC}]8;;http://evil.example${BEL}click me${ESC}]8;;${BEL}`;
    const safe = plainDiagnostic(attack);
    expect(safe).not.toContain(ESC);
    expect(safe).not.toContain(BEL);
    expect(safe).toContain("click me");
  });

  it("leaves no control character behind at all", () => {
    const safe = plainDiagnostic("a\u0000b\u001bc\u009fd\re");
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(safe)).toBe(false);
  });
});
