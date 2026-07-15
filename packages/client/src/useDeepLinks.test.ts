import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve via fileURLToPath (NOT `new URL(…, import.meta.url)`, which happy-dom's
// global URL rejects — see this package's vitest.config.ts).
const here = dirname(fileURLToPath(import.meta.url));
const routerSrc = readFileSync(join(here, "useDeepLinks.ts"), "utf8");

/** The negative pin (DL1 step 6): deep links are VIEW-ONLY BY LAW. A route may
 *  switch a host, focus a tile, open a panel, or open settings — it may NEVER
 *  create a terminal, kill one, write a file, or send keys. The router has no
 *  mutating routes to hit, so a hostile link's worst case is a view change. This
 *  grep pins the law at the source: adding a mutating route to the router fails
 *  THIS test, not merely a reviewer's eye. */
describe("deep-link router is view-only (the negative pin)", () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["terminal create", /lifecycle\.create|handleCreate/],
    ["terminal kill / discard", /lifecycle\.kill|handleKill|handleDiscard/],
    ["worktree mutation", /handleCreateWorktree|handleKillWorktree/],
    [
      "session import / restore",
      /session\.(import|restore)|handleRestoreSession/,
    ],
    ["send keys / write / run", /\.write\(|sendKeys|handleRunInActiveTerminal/],
    ["the mutation RPC face", /activePadiRpc/],
    ["the crud mutation namespace", /\bcrud\./],
  ];

  it.each(FORBIDDEN)("calls no %s verb", (_label, pattern) => {
    expect(routerSrc).not.toMatch(pattern);
  });

  it("only reaches the view seams it is allowed to (positive sanity)", () => {
    // The router's whole vocabulary — a change that adds a NEW seam here is a
    // deliberate edit that should be re-justified against the view-only law.
    for (const allowed of [
      "setActiveHost",
      "store.activate",
      "expandPanel",
      "setActiveSubTab",
      "showInspector",
      "openInCodeTab",
      "setSettingsOpen",
    ]) {
      expect(routerSrc).toContain(allowed);
    }
  });
});
