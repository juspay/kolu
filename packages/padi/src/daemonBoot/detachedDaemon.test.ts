/**
 * The env a detached padi daemon boots with carries NO link's `SSH_AUTH_SOCK`
 * (juspay/kolu#2313). The fact is one line of policy — the stable runtime-home
 * link is the only agent authority (`stdioBridge.ts`) — and this pins it directly.
 *
 * That the env is what the daemon actually receives is proved end to end by the
 * smoke on the PR (`/proc/<pid>/environ` after a real `padi --stdio` spawn), not
 * by asserting a mock was forwarded the arguments.
 */

import { describe, expect, it } from "vitest";
import { detachedPadiDaemonEnv } from "./detachedDaemon.ts";

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
});
