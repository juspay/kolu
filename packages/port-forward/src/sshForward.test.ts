import { describe, expect, it } from "vitest";
import {
  anchorCommandArgs,
  checkCommandArgs,
  forwardCommandArgs,
  forwardSpec,
} from "./sshForward.ts";

/** A stand-in for the real opts prefix, so these stay pure — the real one
 *  creates directories. */
const base = ["-o", "BatchMode=yes", "-o", "ControlMaster=auto"] as const;

describe("forwardSpec", () => {
  it("binds the local end on ALL interfaces", () => {
    // `*:` is the whole reason a browser on another machine can reach this;
    // a loopback bind here would make the forward useless.
    expect(forwardSpec({ localPort: 61000, remotePort: 5173 })).toBe(
      "*:61000:127.0.0.1:5173",
    );
  });

  it("points the far end at the target host's own loopback", () => {
    expect(forwardSpec({ localPort: 1, remotePort: 65535 })).toBe(
      "*:1:127.0.0.1:65535",
    );
  });
});

describe("forwardCommandArgs", () => {
  it("asks the running master to add a listener", () => {
    expect(
      forwardCommandArgs({
        base,
        host: "pu-dev",
        verb: "forward",
        localPort: 61000,
        remotePort: 5173,
      }),
    ).toEqual([
      ...base,
      "-O",
      "forward",
      "-L",
      "*:61000:127.0.0.1:5173",
      "pu-dev",
    ]);
  });

  it("cancels the exact same spec it forwarded", () => {
    const spec = {
      base,
      host: "pu-dev",
      localPort: 61000,
      remotePort: 5173,
    } as const;
    const opened = forwardCommandArgs({ ...spec, verb: "forward" });
    const cancelled = forwardCommandArgs({ ...spec, verb: "cancel" });
    // ssh matches a cancel against the forward's spec, so the two argvs must
    // differ in exactly one word.
    expect(cancelled.filter((arg, i) => arg !== opened[i])).toEqual(["cancel"]);
  });

  it("puts the host last, after every option", () => {
    const args = forwardCommandArgs({
      base,
      host: "zest",
      verb: "forward",
      localPort: 2,
      remotePort: 3,
    });
    expect(args.at(-1)).toBe("zest");
  });
});

describe("checkCommandArgs", () => {
  it("asks ssh whether a master already exists", () => {
    expect(checkCommandArgs({ base, host: "pu-dev" })).toEqual([
      ...base,
      "-O",
      "check",
      "pu-dev",
    ]);
  });
});

describe("anchorCommandArgs", () => {
  it("runs a process that ends when our stdin closes", () => {
    // The anchor exists to keep the shared master out of its ControlPersist
    // idle timer (a forward listener alone does NOT), and it must not outlive
    // us — `cat` on a pipe we hold satisfies both.
    expect(anchorCommandArgs({ base, host: "pu-dev" })).toEqual([
      ...base,
      "pu-dev",
      "cat",
    ]);
  });
});
