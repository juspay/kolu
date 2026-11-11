/** The tool row → card mapping. The kolu-aware arms are what let a card name a
 *  terminal and open it; a call nobody could name must fall to the generic
 *  card rather than guess, which is the direction this is safe to fail in. */

import type { OrchestratorToolRow } from "@kolu/padi-client/orchestrator";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { runningFor, toolCard } from "./toolCard";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const row = (patch: Partial<OrchestratorToolRow>): OrchestratorToolRow => ({
  id: "r1",
  seq: 1,
  since: "2026-01-01T00:00:00.000Z",
  kind: "tool",
  text: "Some call",
  status: "completed",
  ...patch,
});

describe("toolCard", () => {
  it("falls to the generic card for a call with no kolu reading", () => {
    expect(toolCard(row({ text: "Read", detail: "{...}" }))).toEqual({
      kind: "generic",
      title: "Read",
      detail: "{...}",
    });
  });

  it("reads a create", () => {
    const card = toolCard(
      row({
        kolu: {
          kind: "create",
          terminalId: TERMINAL,
          name: "fix-parser",
          cwd: "kolu/.worktrees/fix-parser",
          agent: "claude",
        },
      }),
    );
    expect(card).toMatchObject({
      kind: "create",
      name: "fix-parser",
      agent: "claude",
      terminalId: TERMINAL,
    });
  });

  it("reads typed input and a named key as the same card, differently sent", () => {
    const typed = toolCard(
      row({
        kolu: {
          kind: "sendInput",
          terminalId: TERMINAL,
          name: "fix-parser",
          text: "go",
          key: null,
        },
      }),
    );
    const keyed = toolCard(
      row({
        kolu: {
          kind: "sendInput",
          terminalId: TERMINAL,
          name: "fix-parser",
          text: null,
          key: "Enter",
        },
      }),
    );
    expect(typed).toMatchObject({ sent: { as: "text", value: "go" } });
    expect(keyed).toMatchObject({ sent: { as: "key", value: "Enter" } });
  });

  it("phrases a settle's wait and keeps its screen tail", () => {
    expect(
      toolCard(
        row({
          kolu: {
            kind: "settle",
            terminalId: TERMINAL,
            name: "odu-cache",
            state: "awaiting",
            elapsedMs: 134_000,
            screenTail: "? Retention in days",
          },
        }),
      ),
    ).toMatchObject({
      kind: "settle",
      state: "awaiting",
      waited: "2m 14s",
      screenTail: "? Retention in days",
    });
  });

  it("says nothing about a wait the tool did not report", () => {
    expect(
      toolCard(
        row({
          kolu: {
            kind: "settle",
            terminalId: null,
            name: null,
            state: null,
            elapsedMs: null,
            screenTail: null,
          },
        }),
      ),
    ).toMatchObject({ waited: null });
  });

  it("reads a screen and a kill", () => {
    expect(
      toolCard(
        row({
          kolu: {
            kind: "screen",
            terminalId: TERMINAL,
            name: "zsh",
            snapshot: "$ ",
          },
        }),
      ),
    ).toMatchObject({ kind: "screen", snapshot: "$ " });
    expect(
      toolCard(
        row({ kolu: { kind: "kill", terminalId: TERMINAL, name: "zsh" } }),
      ),
    ).toMatchObject({ kind: "kill", name: "zsh" });
  });
});

describe("runningFor", () => {
  const started = "2026-01-01T00:00:00.000Z";
  const at = (seconds: number) => Date.parse(started) + seconds * 1000;

  it("says nothing for a call that is not running", () => {
    expect(
      runningFor({ status: "completed", startedAt: started }, at(90)),
    ).toBeNull();
  });

  it("says nothing until the wait is worth watching", () => {
    expect(
      runningFor({ status: "in_progress", startedAt: started }, at(1)),
    ).toBeNull();
  });

  it("counts from the writer's stamp, so two tabs agree", () => {
    expect(
      runningFor({ status: "in_progress", startedAt: started }, at(47)),
    ).toBe("47s");
  });

  it("says nothing when the row carries no stamp", () => {
    expect(runningFor({ status: "in_progress" }, at(90))).toBeNull();
  });
});
