/** The `@` menu's row detail: what tells a terminal apart from the others the
 *  menu offers under the same name. Same-named terminals are ordinary — one
 *  repo, several branches — and a menu of five identical rows is a choice a
 *  person cannot make. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { mentionDetail } from "./mentionCandidates";

const meta = (fields: Record<string, unknown>): TerminalMetadata =>
  ({
    state: "active",
    cwd: "/home/srid/code/kolu",
    agent: null,
    ...fields,
  }) as unknown as TerminalMetadata;

describe("mentionDetail", () => {
  it("is the intent a person gave the terminal, first line only", () => {
    expect(
      mentionDetail(
        meta({
          intent: "fix the parser\nand its tests",
          agent: { kind: "claude-code", state: "waiting" },
        }),
      ),
    ).toEqual({ kind: "intent", text: "fix the parser" });
  });

  it("is the agent and its state when there is no intent", () => {
    const detail = mentionDetail(
      meta({ agent: { kind: "claude-code", state: "waiting" } }),
    );
    expect(detail?.kind).toBe("agent");
    expect(detail?.text).toMatch(/^Claude Code · \S/);
  });

  it("is the directory when there is neither", () => {
    expect(mentionDetail(meta({ intent: "  " }))).toEqual({
      kind: "directory",
      text: "/home/srid/code/kolu",
    });
  });

  it("names no agent for a sleeping terminal — it has no live one", () => {
    expect(
      mentionDetail(
        meta({
          state: "sleeping",
          agent: { kind: "claude-code", state: "waiting" },
        }),
      )?.kind,
    ).toBe("directory");
  });
});
