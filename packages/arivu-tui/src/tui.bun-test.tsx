/**
 * Bun-lane render test for the OpenTUI view (`tui.tsx`). It runs under `bun test`
 * (NOT the Node/vitest `ci::unit` lane — OpenTUI's renderer needs Bun's FFI), so
 * the filename's `bun-test` infix keeps it out of vitest's `*.test.ts` glob. Run
 * it with `pnpm --filter arivu-tui test:render`.
 *
 * It asserts the AwarenessRecord component actually PAINTS the projected fields
 * — the layer the pure `render.test.ts` (which only checks the projection data)
 * can't reach. testRender is headless, so no TTY is needed.
 */

import { expect, test } from "bun:test";
import type { AwarenessValue, TerminalId } from "@kolu/arivu-contract";
import { testRender } from "@opentui/solid";
import { AwarenessRecord } from "./tui.tsx";

const value: AwarenessValue = {
  cwd: "/home/u/repo",
  git: { branch: "feat/x", repoName: "repo", remoteUrl: null } as never,
  lastActivityAt: 0,
  pr: {
    kind: "ok",
    value: { number: 12, state: "open", checks: "pass" },
  } as never,
  agent: { kind: "claude-code", state: "awaiting_user" } as never,
  foreground: { name: "nvim", title: null },
};

test("AwarenessRecord paints the id header and every field value", async () => {
  const t = await testRender(
    () => (
      <AwarenessRecord
        id={"a3f10000-abcd" as TerminalId}
        v={value}
        home="/home/u"
        now={1_700_000_000_000}
      />
    ),
    { width: 80, height: 24 },
  );
  await t.renderOnce();
  const frame = t.captureCharFrame();
  t.renderer.destroy();

  // header (short id + tildeified cwd) and the toned fields all reach the frame
  expect(frame).toContain("a3f10000");
  expect(frame).toContain("~/repo");
  expect(frame).toContain("claude · awaiting");
  expect(frame).toContain("#12");
  expect(frame).toContain("feat/x");
  expect(frame).toContain("nvim");
});
