import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routerSrc = readFileSync(join(here, "useDeepLinks.ts"), "utf8");

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

describe("navigate is a command — nothing tracks it (the loop pin)", () => {
  it("delivers external hashes through a plain dispatch, not a tracked signal", () => {
    expect(routerSrc).toContain(
      "export function requestDeepLinkNavigation(hash: string): void",
    );
    expect(routerSrc).toContain("navigateExternal?.(hash);");
    expect(routerSrc).not.toContain("untrack");
  });

  it("registers the dispatch for the router's lifetime only", () => {
    expect(routerSrc).toContain("navigateExternal = navigateFromExternal;");
    expect(routerSrc).toMatch(
      /onCleanup\(\(\) => \{\s*navigateExternal = null;/,
    );
  });
});

describe("boot parse honors the consumed-command stamp (#1900 primary)", () => {
  const BOOT_GUARD = "if (!launchHandled && !entryAlreadyRouted())";

  it("gates the boot parse on the consumed stamp with the exact guard", () => {
    expect(routerSrc).toContain(BOOT_GUARD);
    expect(routerSrc).not.toContain(
      "if (!launchHandled) navigate(parseDeepLink",
    );
  });

  it("the boot guard still routes a fresh cold entry (guards, never removes)", () => {
    const gi = routerSrc.indexOf(BOOT_GUARD);
    expect(gi).toBeGreaterThan(-1);
    expect(routerSrc.slice(gi, gi + 140)).toContain(
      "navigate(parseDeepLink(window.location.hash))",
    );
  });
});

describe("gone-verdict waits for an authoritative list (#1900 secondary)", () => {
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

describe("backstop copy is fact-aware (#1900 R4)", () => {
  it("has a non-authoritative arm that blames the daemon, not the host", () => {
    const backstop = routerSrc.slice(
      routerSrc.indexOf("if (pending() !== route) return;"),
    );
    expect(backstop).toContain("if (target && codeRouteAwaitingRepo");
    expect(backstop).toContain("} else if (!listIsAuthoritative()) {");
    expect(backstop).toContain("daemon isn't running");
  });
});

describe("verdict-time stamping contract (#1900 R1 / codex F4)", () => {
  const resolveBody = () => {
    const start = routerSrc.indexOf("function resolveRoute(");
    expect(start, "resolveRoute missing").toBeGreaterThan(-1);
    return routerSrc.slice(
      start,
      routerSrc.indexOf("function navigate(", start),
    );
  };

  it("derives deferral from the terminalId fact, not a kind list", () => {
    expect(routerSrc).toContain('const deferStamp = "terminalId" in link;');
  });

  it("stamps in exactly one place — the verdict resolver", () => {
    expect((routerSrc.match(/\bstampEntryRouted\(\)[;,]/g) ?? []).length).toBe(
      2,
    );
    expect(
      (resolveBody().match(/\bstampEntryRouted\(\)[;,]/g) ?? []).length,
    ).toBe(2);
  });

  it("leaves the superseded verdict unstamped", () => {
    expect(resolveBody()).toMatch(
      /\.with\(\{ kind: "superseded" \}, \(\) => \{\}\)/,
    );
  });

  it("stamps the ENACTED verdict only AFTER enact returns (retryable on throw)", () => {
    expect(resolveBody()).toMatch(
      /enact\(v\.route, v\.meta\);\s*stampEntryRouted\(\);/s,
    );
  });

  it("keeps an enacted route's focus intent, clears it on every other verdict", () => {
    expect(resolveBody()).toContain(
      'if (verdict.kind !== "enacted") setDeepLinkFocusIntent(null);',
    );
  });

  it("navigate resolves immediately only when the link defers no route", () => {
    const navStart = routerSrc.indexOf("function navigate(");
    const navBody = routerSrc.slice(
      navStart,
      routerSrc.indexOf("function codeRouteAwaitingRepo(", navStart),
    );
    expect(navBody).toContain(
      'if (!deferStamp) resolveRoute({ kind: "immediate" });',
    );
    expect(navBody).not.toContain("stampEntryRouted");
  });

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
    ["not a repo", 'target.git.kind === "none"', "isn't in a git repository"],
    [
      "backstop timeout",
      "if (pending() !== route) return",
      "Couldn't open that file",
    ],
  ])("the %s verdict faults (and so stamps)", (_l, start, end) => {
    expect(between(start, end)).toContain('resolveRoute({ kind: "faulted" });');
  });

  it("keeps exactly the five faulting verdicts (extra guard)", () => {
    expect(
      (routerSrc.match(/resolveRoute\(\{ kind: "faulted" \}\);/g) ?? []).length,
    ).toBe(5);
  });

  it("navigate's leading supersession never stamps", () => {
    const navStart = routerSrc.indexOf("function navigate(");
    const navBody = routerSrc.slice(
      navStart,
      routerSrc.indexOf("function codeRouteAwaitingRepo(", navStart),
    );
    expect(navBody).toContain('resolveRoute({ kind: "superseded" });');
  });

  it("the traversal gate is BARE (already-stamped entry, no re-stamp)", () => {
    const hashchange = routerSrc.slice(routerSrc.indexOf('"hashchange"'));
    expect(hashchange).toContain('resolveRoute({ kind: "superseded" });');
    expect(hashchange).not.toContain('resolveRoute({ kind: "faulted" });');
  });

  it("an external request resets the entry stamp so a same-hash re-route is fresh (codex F1)", () => {
    const ext = routerSrc.slice(
      routerSrc.indexOf("function navigateFromExternal"),
    );
    expect(ext).toContain('if (hash) history.replaceState(null, "", hash);');
  });
});
