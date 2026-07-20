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
      "openSettings",
    ]) {
      expect(routerSrc).toContain(allowed);
    }
  });
});

/** The loop pin: `navigate` is a COMMAND, and its whole body must run under
 *  `untrack`. It reads reactive state (the disarm guard's `pending()`) and
 *  writes it (`setPending`) — executed inside a caller's tracking scope (the
 *  preview-bridge `createEffect` delivers hashes from exactly such a scope),
 *  those reads subscribe the delivering effect to the very signals navigate
 *  writes, and the app busy-loops re-routing forever after the first
 *  bridge-delivered link (reproduced deterministically on both CI platforms;
 *  the DL2 repeat-pill e2e leg is the felt symptom). Losing the `untrack`
 *  must fail THIS test, not resurface as a CI-only e2e red. */
describe("navigate is a command — it runs untracked (the loop pin)", () => {
  it("wraps navigate's body in untrack()", () => {
    const start = routerSrc.indexOf("function navigate(");
    expect(start).toBeGreaterThan(-1);
    const body = routerSrc.slice(
      start,
      routerSrc.indexOf("stampEntryRouted();", start),
    );
    expect(body).toContain("untrack(() => {");
  });
});
