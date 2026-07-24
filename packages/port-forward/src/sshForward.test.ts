import { describe, expect, it } from "vitest";
import { forwardCommandArgs, forwardSpec } from "./sshForward.ts";

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
      "cat",
    ]);
  });

  it("ends in a command that dies with our end of the pipe", () => {
    // NOT `-N`: measured on a live sshd, an `ssh -N -L` child SURVIVES its
    // parent's SIGKILL and keeps serving the port. A remote command reading a
    // pipe we hold gets EOF the instant the kernel closes our fds, which is
    // what makes the forward's lifetime the process's lifetime.
    expect(args).not.toContain("-N");
    expect(args.at(-1)).toBe("cat");
  });

  it("puts the host after every option and before the command", () => {
    expect(args.indexOf("pu-dev")).toBeGreaterThan(args.indexOf("-L"));
    expect(args.indexOf("pu-dev")).toBe(args.length - 2);
  });
});
