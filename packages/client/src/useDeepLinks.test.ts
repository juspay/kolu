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

/** #1900 (PRIMARY — the reproduced cause): the BOOT parse re-enacts a stale,
 *  already-consumed deep link on every reload.
 *
 *  kolu has NO state→URL sync, so the address bar keeps whatever deep link you
 *  last navigated to (a notification click, a shared/bookmarked `#/t/local/<id>`)
 *  even after you switch hosts. Before the fix the boot parse re-parsed
 *  `location.hash` and re-enacted it — running `routeToTerminal` →
 *  `setActiveHost(route.host)`, which yanks you to the stale host (overwriting the
 *  persisted active host, ANY backend) where the local list then settles without
 *  the id and the lying "no longer on that host" toast fires. Reproduced against a
 *  real remote host (PR #1896 comment).
 *
 *  The `koluRouted` consumed-command stamp already exists and SURVIVES a reload in
 *  `history.state` — DL3's traversal gate reads it for back/forward. The fix
 *  extends that ONE authority to the boot arm with the EXACT guard below: a reload
 *  of an already-consumed link does not re-enact (the restored host stands;
 *  session restore owns view restoration across reloads), while a FRESH
 *  bookmark/notification link (no stamp) still routes.
 *
 *  Pinned at the source (this effect world is un-mountable — the same reason the
 *  pins above read `routerSrc`); a live-browser repro rides Phase C evidence. The
 *  guard is pinned as an EXACT string so an inverted `!entryAlreadyRouted()` →
 *  `entryAlreadyRouted()`, a dropped `!launchHandled`, or a comment-only mention
 *  all fail. */
describe("boot parse honors the consumed-command stamp (#1900 primary)", () => {
  // The exact boot guard — inversion or a missing conjunct changes this string.
  const BOOT_GUARD = "if (!launchHandled && !entryAlreadyRouted())";

  it("gates the boot parse on the consumed stamp with the exact guard", () => {
    expect(routerSrc).toContain(BOOT_GUARD);
    // And the pre-fix unconditional boot parse must be GONE (its exact spelling).
    expect(routerSrc).not.toContain(
      "if (!launchHandled) navigate(parseDeepLink",
    );
  });

  it("the boot guard still routes a fresh cold entry (guards, never removes)", () => {
    // Anchor the routing call to the guard itself (the boot arm), NOT whole-file —
    // a whole-file match would survive deleting the boot parse. The routing call
    // immediately follows the guard.
    const gi = routerSrc.indexOf(BOOT_GUARD);
    expect(gi).toBeGreaterThan(-1);
    expect(routerSrc.slice(gi, gi + 140)).toContain(
      "navigate(parseDeepLink(window.location.hash))",
    );
  });
});

/** #1900 (SECONDARY — reshaped by the gate ruling): a genuinely-fresh link (the
 *  class the boot gate still lets route) resolved inside the boot [connect,
 *  inventory-reconciled] window verdicts "gone" off a first settled snapshot
 *  before the list is a complete census.
 *
 *  The gate is ONE line inside the settle effect's `!inList` branch — wait until
 *  `listIsAuthoritative()`, the named census fact defined once in
 *  `kaval/useDaemonStatus.ts` and shared with `useActiveReconcile`'s eviction gate
 *  (one authority, not a private `daemonConnected` re-spell). No pure seam — in
 *  Solid the `!inList`-only read IS the subscription boundary (never subscribed
 *  while present or pending). */
describe("gone-verdict waits for an authoritative list (#1900 secondary)", () => {
  // Slice the settle effect's absent-id branch — `const inList` to the gone
  // toast — so the census gate is pinned INSIDE the `!inList` arm, not elsewhere.
  const inListStart = routerSrc.indexOf("const inList =");
  const goneBranch = routerSrc.slice(
    inListStart,
    routerSrc.indexOf("no longer on", inListStart),
  );

  it("waits on listIsAuthoritative() before the gone verdict, inside !inList", () => {
    expect(inListStart).toBeGreaterThan(-1);
    expect(goneBranch).toContain("if (!listIsAuthoritative()) return");
  });

  it("uses the named census fact, never a private daemonConnected re-spell", () => {
    expect(routerSrc).toContain("listIsAuthoritative()");
    expect(routerSrc).not.toContain("daemonConnected");
  });

  it("defines the fact ONCE and shares it with the reconcile eviction gate", () => {
    // The single authority: defined in useDaemonStatus (delegating to
    // daemonConnected today), and useActiveReconcile's eviction gate reads the
    // SAME name — so the deep-link census and the reconcile census can't drift.
    const daemonSrc = readFileSync(
      join(here, "kaval/useDaemonStatus.ts"),
      "utf8",
    );
    expect(daemonSrc).toContain("export function listIsAuthoritative()");
    expect(daemonSrc).toMatch(
      /export function listIsAuthoritative\(\)[^}]*return daemonConnected\(\);/s,
    );
    const terminalsSrc = readFileSync(
      join(here, "terminal/useTerminals.ts"),
      "utf8",
    );
    expect(terminalsSrc).toContain("isDaemonConnected: listIsAuthoritative");
  });
});

/** #1900 (R4 — honest backstop copy): when the 8s membership backstop fires with
 *  the list still non-authoritative, the host WAS reached but its daemon never
 *  came up — so the toast must say THAT, not a false "couldn't reach the host". */
describe("backstop copy is fact-aware (#1900 R4)", () => {
  it("has a non-authoritative arm that blames the daemon, not the host", () => {
    // The backstop reads the same census fact and picks the honest message.
    const backstop = routerSrc.slice(routerSrc.indexOf("MEMBERSHIP_BOUND_MS"));
    expect(backstop).toContain("if (resolved && codeRouteAwaitingRepo");
    expect(backstop).toContain("} else if (!listIsAuthoritative()) {");
    expect(backstop).toContain("daemon isn't running");
  });
});
