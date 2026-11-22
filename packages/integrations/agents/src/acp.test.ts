import { AGENT_ENV, type Where } from "@kolu/acp/engine";
import { describe, expect, test } from "vitest";

import {
  CONDUCTOR_SEAT,
  conductorCompactingAt,
  conductorOwnMemoryHint,
} from "./acp.ts";

const where = (env: Where["env"]): Where => ({
  env,
  cwd: "/home/demo",
  found: () => null,
});

describe("the Conductor's engine", () => {
  test("is spawned with its own memory off, and without the variables that would move or stop its compaction", () => {
    expect(
      CONDUCTOR_SEAT.at(where({ [AGENT_ENV]: "node /opt/adapter/index.js" })),
    ).toEqual({
      command: "node",
      args: ["/opt/adapter/index.js"],
      env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
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

  test("opens its sessions to compact at 200k with attribution kept off, and says when it will", () => {
    const { leg, compacts } = conductorCompactingAt(200_000);
    expect(leg.compaction).toBe(true);
    expect(leg.rawMessages?.openMeta).toEqual({
      claudeCode: {
        emitRawSDKMessages: [{ type: "system", subtype: "init" }],
        options: {
          settings: {
            attribution: { commit: "", pr: "" },
            autoCompactEnabled: true,
            autoCompactWindow: 233_000,
          },
        },
      },
    });
    expect(compacts.at).toBe(200_000);
    expect(compacts.due({ used: 199_000, size: 1_000_000 })).toBe(false);
    expect(compacts.due({ used: 201_000, size: 1_000_000 })).toBe(true);
  });

  test("opens and fires at the count it is given, not a constant", () => {
    const { leg, compacts } = conductorCompactingAt(500_000);
    expect(leg.rawMessages?.openMeta).toMatchObject({
      claudeCode: { options: { settings: { autoCompactWindow: 533_000 } } },
    });
    expect(compacts.at).toBe(500_000);
    expect(compacts.due({ used: 499_000, size: 1_000_000 })).toBe(false);
    expect(compacts.due({ used: 501_000, size: 1_000_000 })).toBe(true);
  });

  test("hands over where Claude Code kept its own memory, for the bring-over", () => {
    expect(
      conductorOwnMemoryHint(
        { CLAUDE_CONFIG_DIR: "/tmp/scratch/.claude" },
        "/tmp/scratch",
        "/tmp/scratch",
      ),
    ).toContain("/tmp/scratch/.claude/projects");
  });
});
