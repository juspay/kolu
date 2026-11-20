import { AGENT_ENV, type Where } from "@kolu/acp/engine";
import { describe, expect, test } from "vitest";

import { ENGINE } from "./acp.ts";

const where = (env: Where["env"]): Where => ({
  env,
  cwd: "/home/demo",
  found: () => null,
});

describe("the Conductor's engine", () => {
  test("is spawned without the variables that would move or stop its compaction", () => {
    expect(
      ENGINE.at(where({ [AGENT_ENV]: "node /opt/adapter/index.js" })),
    ).toEqual({
      command: "node",
      args: ["/opt/adapter/index.js"],
      unset: [
        "NO_BROWSER",
        "SSH_CONNECTION",
        "SSH_CLIENT",
        "SSH_TTY",
        "CLAUDE_CODE_REMOTE",
        "DISABLE_AUTO_COMPACT",
        "DISABLE_COMPACT",
        "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
        "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE",
      ],
    });
  });

  test("opens its sessions to compact at 200k and says when it will", () => {
    expect(ENGINE.leg.compaction).toBe(true);
    expect(ENGINE.leg.rawMessages?.openMeta).toMatchObject({
      claudeCode: {
        options: {
          settings: { autoCompactEnabled: true, autoCompactWindow: 233_000 },
        },
      },
    });
    expect(ENGINE.compacts?.({ used: 199_000, size: 1_000_000 })).toBe(false);
    expect(ENGINE.compacts?.({ used: 201_000, size: 1_000_000 })).toBe(true);
  });
});
