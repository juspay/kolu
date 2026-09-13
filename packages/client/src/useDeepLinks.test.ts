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
      "store.focusTerminal",
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
    // The single authority: defined once in useDaemonStatus and read by the SAME
    // name in useActiveReconcile's eviction gate, so the deep-link census and the
    // reconcile census can't drift. We pin the NAME + the shared wiring, NOT the
    // current `return daemonConnected()` body — the source docstring flags that as
    // temporary (the padi-side registry-reconciled marker, #1902), so pinning the
    // body would break that planned follow-up while the fact's contract is intact.
    const daemonSrc = readFileSync(
      join(here, "kaval/useDaemonStatus.ts"),
      "utf8",
    );
    expect(daemonSrc).toContain("export function listIsAuthoritative()");
    const terminalsSrc = readFileSync(
      join(here, "terminal/useTerminals.ts"),
      "utf8",
    );
    expect(terminalsSrc).toContain("listIsAuthoritative,");
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

/** #1900 (verdict-time stamping — the OTHER load-bearing half of the primary
 *  fix, pinned so it can't be reverted while the boot-gate test stays green;
 *  codex-debate F4). The contract: a terminal route stamps the entry consumed
 *  ONLY when it RESOLVES (enact, or a disarming verdict via `disarmResolved` =
 *  disarm+stamp), NEVER at parse; an immediate verdict stamps at parse; the enact
 *  stamp lands AFTER enact returns (so a throwing enact stays retryable); and
 *  supersession + traversal use the BARE `disarmInFlightRoute` (no stamp). Also
 *  pins the external-request stamp reset (codex-debate F1). */
describe("verdict-time stamping contract (#1900 R1 / codex F4)", () => {
  it("derives deferral from the terminalId fact, not a kind list", () => {
    // Keyed off the SAME predicate `TerminalRoute = Extract<DeepLink,{terminalId}>`
    // is built on, so a future terminal-targeting kind is covered automatically.
    expect(routerSrc).toContain('const deferStamp = "terminalId" in link;');
  });

  it("navigate stamps ONLY the immediate verdicts (terminal routes defer)", () => {
    const navStart = routerSrc.indexOf("function navigate(");
    const navBody = routerSrc.slice(
      navStart,
      routerSrc.indexOf("function resolveRoute(", navStart),
    );
    // navigate's ONLY stamp is the one guarded by !deferStamp — a second,
    // unconditional stamp (the pre-fix parse-time behaviour) would make this 2.
    expect(navBody).toContain("if (!deferStamp) stampEntryRouted();");
    expect((navBody.match(/stampEntryRouted\(\)/g) ?? []).length).toBe(1);
  });

  it("disarmResolved's body is disarm THEN stamp", () => {
    expect(routerSrc).toMatch(
      /function disarmResolved\(\)[^}]*disarmInFlightRoute\(\);[^}]*stampEntryRouted\(\);/s,
    );
  });

  // Anchor each disarming verdict to its OWN branch — a location-insensitive
  // global count would pass a two-site swap (e.g. leading supersession →
  // disarmResolved while list-error → bare) that keeps the count at 4 yet stamps a
  // fresh superseding command and un-stamps a fault verdict (codex-debate F4 r2).
  const between = (start: string, end: string) => {
    const i = routerSrc.indexOf(start);
    const j = routerSrc.indexOf(end, i + 1);
    expect(i, `start anchor missing: ${start}`).toBeGreaterThan(-1);
    expect(j, `end anchor missing: ${end}`).toBeGreaterThan(i);
    return routerSrc.slice(i, j);
  };

  it.each([
    ["host-mismatch supersession", "!== route.host", "store.listSub.pending()"],
    [
      "list-stream fault",
      "const listError = store.listSub.error()",
      "const id = route.terminalId",
    ],
    [
      "gone (post-authority)",
      "if (!listIsAuthoritative()) return",
      "no longer on",
    ],
    [
      "backstop timeout",
      "if (pending() !== route) return",
      "Couldn't open that file",
    ],
  ])("the %s verdict stamps (disarmResolved in its own branch)", (_l, start, end) => {
    expect(between(start, end)).toContain("disarmResolved();");
  });

  it("keeps exactly the four disarming verdicts stamping (extra guard)", () => {
    expect((routerSrc.match(/\bdisarmResolved\(\);/g) ?? []).length).toBe(4);
  });

  it("stamps the ENACTED path only AFTER enact returns (retryable on throw)", () => {
    expect(routerSrc).toMatch(
      /enact\(route, resolved\.anchorMeta\);\s*stampEntryRouted\(\);/s,
    );
  });

  it("navigate's leading supersession is BARE (disarmInFlightRoute, never stamps)", () => {
    // The new command's entry must stay unstamped through the leading disarm — its
    // own terminal route stamps only at resolution. So navigate never disarmResolves.
    const navStart = routerSrc.indexOf("function navigate(");
    const navBody = routerSrc.slice(
      navStart,
      routerSrc.indexOf("function resolveRoute(", navStart),
    );
    expect(navBody).toContain("disarmInFlightRoute();");
    expect(navBody).not.toContain("disarmResolved");
  });

  it("the traversal gate is BARE (already-stamped entry, no re-stamp)", () => {
    const hashchange = routerSrc.slice(routerSrc.indexOf('"hashchange"'));
    expect(hashchange).toContain("disarmInFlightRoute();");
    expect(hashchange).not.toContain("disarmResolved();");
  });

  it("an external request resets the entry stamp so a same-hash re-route is fresh (codex F1)", () => {
    // navigateFromExternal clears any prior koluRouted stamp for ANY non-empty
    // hash (not only a changed one), so a same-hash re-request is unstamped until
    // it resolves — a mid-flight reload then re-routes instead of being skipped.
    const ext = routerSrc.slice(
      routerSrc.indexOf("function navigateFromExternal"),
    );
    expect(ext).toContain('if (hash) history.replaceState(null, "", hash);');
  });
});
