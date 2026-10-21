/**
 * The one re-exec path both `--stdio` front spawn sites take — and the env scrub
 * that makes the daemon carry NO link's `SSH_AUTH_SOCK` (juspay/kolu#2313).
 *
 * Two call sites produce a durable padi: the relay's adopt-or-spawn
 * (`stdioBridge.ts`) and the converge pre-step's takeover driver
 * (`convergeFront.ts`). Both call `spawnDetachedPadi`, so asserting its env
 * asserts what both pass. The fact under test is the fix's other half: the
 * daemon owns no ssh session, so it must never inherit one link's per-session
 * agent socket — the stable runtime-home link is the only authority.
 */

import type { ReExecAsDetachedDaemonOptions } from "@kolu/surface-daemon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { padiStderrLogPath } from "../stateRoot.ts";
import { detachedPadiDaemonEnv, spawnDetachedPadi } from "./detachedDaemon.ts";

const reExec = vi.hoisted(() => vi.fn());

vi.mock("@kolu/surface-daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kolu/surface-daemon")>();
  return { ...actual, reExecAsDetachedDaemon: reExec };
});

describe("detachedPadiDaemonEnv", () => {
  it("drops SSH_AUTH_SOCK and keeps everything else", () => {
    // Whole-env pin: the daemon's env is a copy minus that ONE key — not a
    // rebuilt allowlist, which would silently lose the wrapper's PATH / build id.
    const env = detachedPadiDaemonEnv({
      SSH_AUTH_SOCK: "/tmp/ssh-XXXX/agent.1000",
      PATH: "/nix/store/bin:/usr/bin",
      KOLU_PADI_STATE_DIR: "/home/u/.local/state/padi",
      KOLU_AGENT_TOOLS_PATH: "/nix/store/tools",
    });

    expect(env).toEqual({
      PATH: "/nix/store/bin:/usr/bin",
      KOLU_PADI_STATE_DIR: "/home/u/.local/state/padi",
      KOLU_AGENT_TOOLS_PATH: "/nix/store/tools",
    });
  });

  it("is an honest absence, not a blank value", () => {
    // A present-but-empty SSH_AUTH_SOCK would read as "an agent at the empty
    // path" downstream; the key must be GONE, exactly like a host with no agent.
    expect(
      "SSH_AUTH_SOCK" in detachedPadiDaemonEnv({ SSH_AUTH_SOCK: "" }),
    ).toBe(false);
  });
});

describe("spawnDetachedPadi — the env both re-exec sites pass", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.SSH_AUTH_SOCK;
    reExec.mockClear();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = saved;
  });

  it("re-execs the daemon stripped of --stdio, with NO SSH_AUTH_SOCK", () => {
    // A live ssh link would have this set; the daemon it spawns must not keep it.
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-XXXX/agent.1000";

    spawnDetachedPadi("/home/u/.local/state/padi");

    expect(reExec).toHaveBeenCalledTimes(1);
    const [opts] = reExec.mock.calls[0] as [ReExecAsDetachedDaemonOptions];
    expect(opts.stripArgs).toEqual(["--stdio"]);
    expect(opts.stderrLog).toBe(padiStderrLogPath("/home/u/.local/state/padi"));
    expect(opts.env).toBeDefined();
    expect("SSH_AUTH_SOCK" in (opts.env ?? {})).toBe(false);
  });
});
