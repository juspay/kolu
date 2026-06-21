/**
 * Bun-lane render test for the OpenTUI dashboard (`tui.tsx`). Runs under
 * `bun test` (NOT the Node/vitest `test:unit` lane — OpenTUI's renderer needs
 * Bun's FFI), so the `bun-test` infix keeps it out of vitest's `*.test.ts` glob.
 * Run it with `pnpm --filter arivu-tui test:render`.
 *
 * It asserts AwarenessTable actually PAINTS the header + a terminal row — the
 * layer the pure `render.test.ts` (which checks only the projection data) can't
 * reach, and the proof the native renderer loads and renders. testRender is
 * headless, so no TTY is needed.
 */

import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { DashRow } from "./render.ts";
import { AwarenessTable } from "./tui.tsx";

const rows: DashRow[] = [
  {
    id: { text: "a3f10000", tone: "plain" },
    repoBranch: { text: "kolu·feat/x", tone: "plain" },
    pr: { text: "#12 open ✓", tone: "pass" },
    agent: { text: "claude · awaiting", tone: "awaiting" },
    foreground: { text: "nvim", tone: "plain" },
    active: { text: "3s", tone: "muted" },
  },
];

test("AwarenessTable paints the header and a terminal row", async () => {
  const t = await testRender(
    () => <AwarenessTable rows={rows} clock={() => "12:00:00"} />,
    { width: 90, height: 12 },
  );
  await t.renderOnce();
  const frame = t.captureCharFrame();
  t.renderer.destroy();

  expect(frame).toContain("REPO·BRANCH");
  expect(frame).toContain("a3f10000");
  expect(frame).toContain("kolu·feat/x");
  expect(frame).toContain("awaiting");
  expect(frame).toContain("#12");
  expect(frame).toContain("nvim");
  expect(frame).toContain("12:00:00");
});
