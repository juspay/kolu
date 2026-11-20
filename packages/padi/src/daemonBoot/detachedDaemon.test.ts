import { describe, expect, it } from "vitest";
import { detachedPadiDaemonEnv } from "./detachedDaemon.ts";

describe("detachedPadiDaemonEnv", () => {
  it("drops SSH_AUTH_SOCK and keeps everything else", () => {
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
