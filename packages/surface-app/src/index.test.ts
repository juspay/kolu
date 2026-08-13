/**
 * The freshness contract's pure kernels — the bits worth unit-testing in
 * isolation (no Hono, no Solid, no surface). These tests are the replacement
 * for the old per-consumer suites (server's `cacheControl.test.ts`, the
 * client's `commitRef.test.ts`, the deleted PWA test) that moved here when the
 * helpers were extracted into `@kolu/surface-app`. The whole point of the
 * extraction is to preserve these regression-prone paths once.
 */

import { describe, expect, it } from "vitest";
import {
  ASSET_MISS_CACHE_CONTROL,
  cacheControlFor,
  clientIsStale,
  injectShellCommit,
  injectShellHead,
  isCleanRef,
  isImmutableAssetPath,
  NOTIFICATION_SW_SOURCE,
  PRECOMPRESSED_ENCODINGS,
  SHELL_CACHE_CONTROL,
  SHELL_COMMIT_GLOBAL,
  shellCommitScript,
  SURFACE_WS_PATH,
  surfaceWsUrl,
  SW_MESSAGE_TYPE,
  SW_SOURCE,
  thrownText,
} from "./index";

describe("thrownText", () => {
  it("returns a V8-shaped stack as-is — the message is already its first line", () => {
    const err = new Error("boom");
    // Node/V8: `stack` starts with `Error: boom`. Prepending would double it.
    expect(err.stack?.startsWith("Error: boom")).toBe(true);
    expect(thrownText(err)).toBe(err.stack);
  });

  it("puts a lost message back on the front of a Safari-shaped stack", () => {
    // Safari's `stack` carries frames only — printing it alone would name
    // files but not the fault.
    const err = new Error("undefined is not an object");
    err.stack = "renderRow@app.js:12:3\nmain@app.js:1:1";
    expect(thrownText(err)).toBe(
      "Error: undefined is not an object\nrenderRow@app.js:12:3\nmain@app.js:1:1",
    );
  });

  it("puts a SHORT lost message back even when it appears inside a frame", () => {
    // The hole a substring test (`includes`) leaves open: a short message —
    // "app", "12", "null", the shape short DOM/JSON/index errors arrive in —
    // is routinely a substring of the first frame's function name, file stem,
    // or line number. The rule is the first line BEING the current header,
    // not containing the message somewhere.
    for (const message of ["app", "12", "renderRow"]) {
      const err = new Error(message);
      err.stack = "renderRow@app.js:12:3";
      expect(thrownText(err)).toBe(`Error: ${message}\nrenderRow@app.js:12:3`);
    }
  });

  it("puts a reassigned message back when the new one is a SUBSTRING of the old header", () => {
    // The same hole on the V8 side: shorten the message after the header
    // materialized and the stale header *contains* (even starts with) the new
    // one. "Carries" must mean the header IS `name: message`, on a line
    // boundary — a bare prefix test waves "Error: foobar" through for "foo".
    const shortened = new Error("foobar");
    void shortened.stack;
    shortened.message = "foo";
    expect(shortened.stack?.startsWith("Error: foobar")).toBe(true);
    expect(thrownText(shortened)).toBe(`Error: foo\n${shortened.stack}`);

    const substring = new Error("the original reason");
    void substring.stack;
    substring.message = "original";
    expect(thrownText(substring)).toBe(`Error: original\n${substring.stack}`);
  });

  it("never LOSES a multiline message — a header spanning lines can't match one line, so it errs toward saying it twice", () => {
    // A multiline message can never equal the stack's first physical line, so
    // the first-line rule treats it as lost and puts it back on the front.
    // That is the safe direction — the current message is always at the top
    // of the card, at worst repeated below — and this pins exactly the
    // never-lost half without freezing the duplication as a contract.
    const err = new Error("line one\nline two");
    expect(err.stack?.startsWith("Error: line one\nline two")).toBe(true);
    expect(thrownText(err).startsWith("Error: line one\nline two")).toBe(true);
  });

  it("puts a REASSIGNED message back too — a V8 stack keeps the one from construction", () => {
    // `e.message = "the real reason"` after the stack has materialized (V8
    // formats `.stack` lazily and caches the string on first read) leaves the
    // stack opening with the OLD message. A test on the name prefix alone
    // would wave that stale first line through; the rule is whether the first
    // line carries the CURRENT message.
    const err = new Error("original");
    void err.stack; // materialize the header with the construction-time message
    err.message = "the real reason";
    expect(err.stack?.startsWith("Error: original")).toBe(true);
    expect(thrownText(err)).toBe(`Error: the real reason\n${err.stack}`);
  });

  it("does not double a message-less Error's stack — every line 'carries' an empty message", () => {
    const err = new Error();
    // V8: `stack` opens with the bare name; the fallback name-prefix test
    // keeps it as-is instead of prepending "Error: ".
    expect(thrownText(err)).toBe(err.stack);
  });

  it("prints `name: message` for a stackless Error, keeping the subclass name", () => {
    const err = new RangeError("day out of range");
    err.stack = undefined;
    expect(thrownText(err)).toBe("RangeError: day out of range");
    err.stack = "";
    expect(thrownText(err)).toBe("RangeError: day out of range");
  });

  it("routes a DOMException through the Error branch, name intact", () => {
    // `DOMException` IS `instanceof Error` (Node and every current browser),
    // and its `name` is the fault's vocabulary (`AbortError`, `DataError`, …).
    const text = thrownText(new DOMException("boom", "DataError"));
    expect(text.startsWith("DataError: boom")).toBe(true);
  });

  it("stringifies a non-Error throw — a render can throw anything", () => {
    expect(thrownText("just a string")).toBe("just a string");
    expect(thrownText(undefined)).toBe("undefined");
    expect(thrownText(42)).toBe("42");
  });

  it("never prints an empty card: a value that says nothing is still a fault", () => {
    expect(thrownText("")).toBe(
      "the page threw a value that says nothing about itself",
    );
  });
});

describe("surfaceWsUrl", () => {
  it("maps the scheme and pins the surface path, whatever the base carried", () => {
    // The scheme swap is the part that is easy to get wrong, and wrong only in
    // deployment: a TLS-served app that dials `ws:` fails nowhere else.
    expect(surfaceWsUrl("http://127.0.0.1:7681")).toBe(
      `ws://127.0.0.1:7681${SURFACE_WS_PATH}`,
    );
    expect(surfaceWsUrl("https://kolu.example")).toBe(
      `wss://kolu.example${SURFACE_WS_PATH}`,
    );
    // A base carrying its own path is REPLACED, not appended to — the surface
    // speaks on exactly one path and the upgrade handler compares for equality.
    expect(surfaceWsUrl("http://box:5173/some/page")).toBe(
      `ws://box:5173${SURFACE_WS_PATH}`,
    );
  });

  it("keeps a bracketed IPv6 authority intact", () => {
    // The other half of the address story: what `hostAuthority` bracketed must
    // survive the parse-and-reserialize round trip.
    expect(surfaceWsUrl("http://[::1]:7714/")).toBe(
      `ws://[::1]:7714${SURFACE_WS_PATH}`,
    );
  });
});

// The stale-tab DECISION is no longer a pure kernel here: `rejectStaleProcess`
// took the "live" id as an argument, and that argument was the way to point the
// gate at an id the wire never reports. The decision now lives inside
// `gateStaleSocket`, which reads this process's own `surfaceProcessId()` — see
// `server.test.ts`, where it is tested through the door it is now only reachable
// by.

describe("cacheControlFor", () => {
  it("pins content-hashed assets immutable", () => {
    expect(cacheControlFor("/assets/index-CDOaNpvy.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(cacheControlFor("/assets/index-BB54dgc_.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("makes the SPA shell no-store so a normal reload can't replay a stale shell", () => {
    expect(cacheControlFor("/")).toBe("no-store");
    expect(cacheControlFor("/index.html")).toBe("no-store");
  });

  it("revalidates /sw.js so the self-destructing worker is always re-fetched", () => {
    expect(cacheControlFor("/sw.js")).toBe("no-cache, must-revalidate");
  });

  it("has no opinion on anything else — including retired SW scripts", () => {
    expect(cacheControlFor("/registerSW.js")).toBeNull();
    expect(cacheControlFor("/workbox-01f28f5c.js")).toBeNull();
    expect(cacheControlFor("/favicon.svg")).toBeNull();
    expect(cacheControlFor("/manifest.webmanifest")).toBeNull();
    expect(cacheControlFor("/deep/client/route")).toBeNull();
  });

  it("honors a custom asset prefix + shell paths", () => {
    const paths = { assetPrefix: "/static/", shellPaths: ["/", "/app.html"] };
    expect(cacheControlFor("/static/x-hash.js", paths)).toBe(
      "public, max-age=31536000, immutable",
    );
    // The Vite default prefix is no longer special under an override.
    expect(cacheControlFor("/assets/x-hash.js", paths)).toBeNull();
    expect(cacheControlFor("/app.html", paths)).toBe("no-store");
  });
});

describe("injectShellCommit", () => {
  const shell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script type="module" crossorigin src="/assets/index-D85Q74Rn.js"></script>
  </head>
  <body></body>
</html>`;

  it("injects the commit script after <head>, BEFORE the module bundle reads it", () => {
    const out = injectShellCommit(shell, "0fab0cc");
    const script = shellCommitScript("0fab0cc");
    expect(out).toContain(script);
    expect(out.indexOf(script)).toBeLessThan(
      out.indexOf("/assets/index-D85Q74Rn.js"),
    );
    // The script publishes the SHELL global — the one `shellCommit()` reads.
    expect(script).toContain(`window.${SHELL_COMMIT_GLOBAL}=`);
  });

  it("leaves the hashed asset references byte-identical (identity rides the shell, never the bundle — kolu#1319)", () => {
    const out = injectShellCommit(shell, "0fab0cc");
    expect(out).toContain('src="/assets/index-D85Q74Rn.js"');
  });

  it("escapes the commit so an arbitrary string can't break out of the script element", () => {
    // A sha is [0-9a-f], but the helper must not rely on that: `</script>`
    // inside the literal would terminate the element mid-string.
    const script = shellCommitScript("</script><script>alert(1)");
    expect(script.toLowerCase()).not.toContain("</script><script>alert");
  });

  it("throws on a template with no <head> — a shell with no identity must not build", () => {
    expect(() => injectShellCommit("<html><body></body></html>", "x")).toThrow(
      /<head>/,
    );
  });

  it("does NOT mistake <header> for <head> — that would inject at the wrong spot and silently build a no-<head> shell", () => {
    // `<head[^>]*>` would match `<header>`; the boundary'd regex must not, so a
    // shell whose only `head`-prefixed tag is a body `<header>` fails loud.
    expect(() =>
      injectShellCommit(
        "<html><body><header>nav</header></body></html>",
        "0fab0cc",
      ),
    ).toThrow(/<head>/);
  });

  it("matches a <head> carrying attributes", () => {
    const out = injectShellCommit(
      '<html><head lang="en"><title>x</title></head><body></body></html>',
      "0fab0cc",
    );
    const script = shellCommitScript("0fab0cc");
    expect(out).toContain(script);
    // Injected right after the (attribute-bearing) head open tag.
    expect(out.indexOf(script)).toBeLessThan(out.indexOf("<title>"));
  });

  it("throws on an unterminated <head> tag", () => {
    expect(() => injectShellCommit('<html><head lang="en"', "x")).toThrow(
      /unterminated/,
    );
  });
});

// The head prelude the Bun build writes — the same splice, with the modulepreload
// links ahead of the commit script. Which chunks end up in that list is
// `modulePreload.test.ts`'s question; this is the ORDER and the tags.
const headShell = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body><script type="module" src="/assets/main-D85Q74Rn.js"></script></body>
</html>`;

describe("injectShellHead", () => {
  it("writes the preload links first and the commit script after, right after <head>", () => {
    // Pinned as a LITERAL, in one string: `rel="modulepreload"` is the whole
    // instruction to the browser, and the adjacency IS the order — a test that
    // rebuilt the tags from the same helper, or checked the two halves
    // separately, would agree with a typo or a swap.
    const out = injectShellHead(headShell, {
      preloadHrefs: ["/assets/shared-a1b2c3d4.js", "/assets/base-e5f6a7b8.js"],
      commit: "0fab0cc",
    });
    expect(out).toContain(
      '<head><link rel="modulepreload" href="/assets/shared-a1b2c3d4.js">' +
        '<link rel="modulepreload" href="/assets/base-e5f6a7b8.js">' +
        shellCommitScript("0fab0cc"),
    );
    // And so ahead of the entry the preloaded chunks belong to.
    expect(out.indexOf("modulepreload")).toBeLessThan(
      out.indexOf("/assets/main-D85Q74Rn.js"),
    );
  });

  it("adds no preload tags when the entry split into nothing — just the identity", () => {
    // The no-split app is most apps. It must come out with no empty `<link>`, no
    // stray whitespace — nothing to explain.
    const out = injectShellHead(headShell, {
      preloadHrefs: [],
      commit: "0fab0cc",
    });
    expect(out).not.toContain("modulepreload");
    expect(out).toBe(
      headShell.replace("<head>", `<head>${shellCommitScript("0fab0cc")}`),
    );
  });

  it("names the preload cost too when there is no <head> to splice into", () => {
    // The locator itself (the `<header>` trap, the unterminated tag) is pinned in
    // `index.test.ts` through `injectShellCommit`, which is the same splice. What
    // is only true here is what the error has to SAY now that the prelude carries
    // two things: a template with no head loses the round trip as well as the
    // identity, and a message naming one of them reads like the whole cost.
    expect(() =>
      injectShellHead("<html><body></body></html>", {
        preloadHrefs: ["/assets/a-1.js"],
        commit: "0fab0cc",
      }),
    ).toThrow(/no <head>.*round trip/);
  });
});

describe("the modulepreload tags injectShellHead writes", () => {
  const tags = (hrefs: readonly string[]) =>
    injectShellHead(headShell, { preloadHrefs: hrefs, commit: "0fab0cc" })
      .split("<head>")[1]!
      .split("<script>")[0]!;
  it("emits one tag per href, in order, as one string", () => {
    // Pinned as a LITERAL: `rel="modulepreload"` is the whole instruction to the
    // browser, and a test that rebuilt the tag from the same helper would agree
    // with any typo in it.
    expect(
      tags(["/assets/shared-a1b2c3d4.js", "/assets/base-e5f6a7b8.js"]),
    ).toBe(
      '<link rel="modulepreload" href="/assets/shared-a1b2c3d4.js">' +
        '<link rel="modulepreload" href="/assets/base-e5f6a7b8.js">',
    );
  });

  it("emits nothing at all for no hrefs", () => {
    expect(tags([])).toBe("");
  });

  it("refuses an href that is not a plain /path instead of ending the attribute early", () => {
    // The sibling `shellCommitScript` ESCAPES its input because a commit message
    // is arbitrary by nature; a build output name that carries a quote means
    // something upstream is already wrong, so this one refuses.
    expect(() => tags(['/assets/a".js'])).toThrow(/href/);
    expect(() => tags(["https://cdn.example/a.js"])).toThrow(/plain \/path/);
  });
});

describe("PRECOMPRESSED_ENCODINGS", () => {
  // This table is the ONE place the negotiator (`./server`) and the emitter
  // (`./precompress`) meet, which makes it the one place a whole encoding can
  // go missing without anything else disagreeing: drop a row and both halves
  // forget it together, so an emitter-equals-table assertion stays green while
  // the encoding silently stops being served. That is exactly how `.zst` came
  // to be absent from every consumer's dist while the server had supported it
  // all along. So the rows are pinned as LITERALS here — a deletion has to
  // survive a test that names the thing, not a test that compares two halves of
  // the same mistake.
  it("carries br/zstd/gzip against .br/.zst/.gz, in the server's preference order", () => {
    expect(PRECOMPRESSED_ENCODINGS).toEqual([
      ["br", ".br"],
      ["zstd", ".zst"],
      ["gzip", ".gz"],
    ]);
  });

  it("keeps `zstd` → `.zst` — the row whose absence was the bug", () => {
    // Named on its own so a diff that drops it reads as what it is, rather than
    // as one line of a table rewrite.
    expect(PRECOMPRESSED_ENCODINGS).toContainEqual(["zstd", ".zst"]);
  });

  it("names each encoding and each suffix once — a duplicate would shadow a row", () => {
    const encodings = PRECOMPRESSED_ENCODINGS.map(([encoding]) => encoding);
    const suffixes = PRECOMPRESSED_ENCODINGS.map(([, suffix]) => suffix);
    expect(new Set(encodings).size).toBe(encodings.length);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });
});

describe("isImmutableAssetPath", () => {
  it("matches the content-hashed asset dir (a miss there must 404, not the shell)", () => {
    expect(isImmutableAssetPath("/assets/index-CDOaNpvy.js")).toBe(true);
    expect(isImmutableAssetPath("/assets/anything")).toBe(true);
  });

  it("rejects every non-asset path (those still fall through to the SPA shell)", () => {
    for (const p of [
      "/",
      "/index.html",
      "/sw.js",
      "/favicon.svg",
      "/foo.js",
      "/sounds/x.mp3",
      "/assetsX/y.js",
      "/deep/route",
    ]) {
      expect(isImmutableAssetPath(p)).toBe(false);
    }
  });

  it("the asset-miss directive is itself no-store (a 404 must not be cached either)", () => {
    expect(ASSET_MISS_CACHE_CONTROL).toBe("no-store");
    expect(SHELL_CACHE_CONTROL).toBe("no-store");
  });
});

describe("isCleanRef", () => {
  it.each([
    { sha: "0784979", expected: true, why: "a real short SHA" },
    { sha: undefined, expected: false, why: "absent" },
    { sha: "", expected: false, why: "empty" },
    { sha: "dev", expected: false, why: "the dev sentinel" },
    { sha: "0784979-dirty", expected: false, why: "a dirty working tree" },
  ])("$why → $expected", ({ sha, expected }) => {
    expect(isCleanRef(sha)).toBe(expected);
  });
});

describe("clientIsStale", () => {
  it.each([
    {
      server: "0784979",
      client: "abc1234",
      expected: true,
      why: "two clean refs that disagree → stale (cached old bundle)",
    },
    {
      server: "0784979",
      client: "0784979",
      expected: false,
      why: "identical clean refs → up to date",
    },
    {
      server: "dev",
      client: "abc1234",
      expected: false,
      why: "dev server can't prove staleness",
    },
    {
      server: "0784979",
      client: "dev",
      expected: false,
      why: "dev client can't be called stale",
    },
    {
      server: "0784979-dirty",
      client: "abc1234",
      expected: false,
      why: "dirty server is not a trustworthy baseline",
    },
    {
      server: "0784979",
      client: "abc1234-dirty",
      expected: false,
      why: "dirty client is a local build, not a cache miss",
    },
    {
      server: undefined,
      client: "abc1234",
      expected: false,
      why: "no server info yet (link still connecting)",
    },
  ])("$why", ({ server, client, expected }) => {
    expect(clientIsStale(server, client)).toBe(expected);
  });
});

describe("SW_SOURCE (the self-destructing retirement worker)", () => {
  it("skips waiting, unregisters itself, deletes caches, and reloads tabs", () => {
    expect(SW_SOURCE).toContain("self.skipWaiting()");
    expect(SW_SOURCE).toContain("self.registration.unregister()");
    expect(SW_SOURCE).toContain("caches.delete");
    expect(SW_SOURCE).toContain("client.navigate(client.url)");
  });
});

describe("NOTIFICATION_SW_SOURCE (the fetch-less notification worker)", () => {
  it("registers NO fetch handler — the property that keeps it freshness-safe", () => {
    // A fetch handler is the only way a worker can serve a stale shell; without
    // one it does zero caching, so it can't violate the freshness contract.
    expect(NOTIFICATION_SW_SOURCE).not.toContain('"fetch"');
    expect(NOTIFICATION_SW_SOURCE).not.toContain("onfetch");
  });

  it("handles notificationclick and routes the click back to a window", () => {
    // The worker stamps the shared SW_MESSAGE_TYPE discriminator on the click
    // envelope (interpolated from the exported constant, not a duplicated literal),
    // so a rename moves both sides at once instead of silently desyncing the page.
    expect(NOTIFICATION_SW_SOURCE).toContain(JSON.stringify(SW_MESSAGE_TYPE));
    expect(NOTIFICATION_SW_SOURCE).toContain("client.focus()");
    expect(NOTIFICATION_SW_SOURCE).toContain("client.postMessage");
    expect(NOTIFICATION_SW_SOURCE).toContain("openWindow");
  });

  it("heals a legacy caching worker on activate (purge caches + claim), without self-unregistering", () => {
    expect(NOTIFICATION_SW_SOURCE).toContain("self.skipWaiting()");
    expect(NOTIFICATION_SW_SOURCE).toContain("caches.delete");
    expect(NOTIFICATION_SW_SOURCE).toContain("self.clients.claim()");
    // It must persist (it's the live notification host) — unlike SW_SOURCE.
    expect(NOTIFICATION_SW_SOURCE).not.toContain(
      "self.registration.unregister()",
    );
  });

  it("navigates open windows when it purges a legacy cache, so retirement needs no user action", () => {
    // The stale-client guarantee SW_SOURCE gives: a tab the legacy caching
    // worker may have served a stale shell to must land on the fresh shell with
    // no manual reload. Presence of caches is the tell-tale; the navigate is
    // gated on it so a clean first install never reloads a tab gratuitously.
    expect(NOTIFICATION_SW_SOURCE).toContain("keys.length > 0");
    expect(NOTIFICATION_SW_SOURCE).toContain("client.navigate(client.url)");
  });
});
