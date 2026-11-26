import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import {
  devSmokeFailures,
  foldDiagnostics,
  type PageDiagnostic,
  SOLID_DIAGNOSTIC_BINDING,
  solidDevCheckFor,
  solidDiagnosticVerdict,
  solidObserveInitScript,
  stampDiagnostic,
} from "./solidDevBuild.ts";

const MARKER = "what it means and how to fix it:";
const WARNING = 'useHead: ignoring invalid attribute name "';
const SHELL =
  '<!doctype html><html><body><script src="/assets/app.js"></script></body></html>';

const servers: Server[] = [];
after(() => {
  for (const server of servers) server.close();
});

/**
 * A stand-in for a kolu server's static serving, in the shape
 * `freshStaticLayer` actually answers in (packages/surface-app/src/server.ts):
 * known files by name, and EVERY other path the HTML shell with a 200 — which
 * is what "no manifest" looks like on the wire.
 */
async function serve(files: Record<string, [string, string]>): Promise<string> {
  return start((req, res) => {
    const entry = files[(req.url ?? "/").split("?")[0] as string];
    const [type, body] = entry ?? ["text/html; charset=utf-8", SHELL];
    res.writeHead(200, { "content-type": type });
    res.end(body);
  });
}

/** A listening server on a free port, closed when the file's tests are done. */
async function start(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const DEV_FILES = {
  "/": ["text/html; charset=utf-8", SHELL],
  "/assets/app.js": [
    "text/javascript",
    `console.log("[REACTIVITY_DIAGNOSTIC] ${MARKER} https://example");`,
  ],
  "/solid-dev.json": [
    "application/json; charset=utf-8",
    JSON.stringify({
      marker: MARKER,
      warnings: [WARNING],
    }),
  ],
} satisfies Record<string, [string, string]>;

/** Run `body` with `KOLU_E2E_SOLID_DEV` set as the lane sets it (or unset). */
async function withLaneFlag(
  value: string | undefined,
  body: () => Promise<void>,
): Promise<void> {
  const saved = process.env.KOLU_E2E_SOLID_DEV;
  if (value === undefined) delete process.env.KOLU_E2E_SOLID_DEV;
  else process.env.KOLU_E2E_SOLID_DEV = value;
  try {
    await body();
  } finally {
    if (saved === undefined) delete process.env.KOLU_E2E_SOLID_DEV;
    else process.env.KOLU_E2E_SOLID_DEV = saved;
  }
}

test("a dev-runtime server turns the check on with NO flag set", async () => {
  await withLaneFlag(undefined, async () => {
    const check = await solidDevCheckFor(await serve(DEV_FILES));
    assert.ok(check, "a server serving the manifest must be checked");
    // The footered diagnostics channel…
    assert.equal(
      check.isDiagnostic(`[REACTIVITY_HALTED] ${MARKER} https://x`),
      true,
    );
    // …and a plain console.warn, which carries no footer at all.
    assert.equal(check.isDiagnostic(`${WARNING}data foo"`), true);
    assert.equal(check.isDiagnostic("terminal resized"), false);
  });
});

test("a production server leaves the check off — its shell answers 200", async () => {
  await withLaneFlag(undefined, async () => {
    const baseUrl = await serve({ "/": ["text/html; charset=utf-8", SHELL] });
    assert.equal(await solidDevCheckFor(baseUrl), undefined);
  });
});

test("a 404 for the manifest leaves the check off too", async () => {
  await withLaneFlag(undefined, async () => {
    const baseUrl = await start((_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
    assert.equal(await solidDevCheckFor(baseUrl), undefined);
  });
});

test("the lane fails on a server that serves no manifest", async () => {
  await withLaneFlag("1", async () => {
    const baseUrl = await serve({ "/": ["text/html; charset=utf-8", SHELL] });
    await assert.rejects(
      solidDevCheckFor(baseUrl),
      /serves no \/solid-dev\.json/,
    );
  });
});

test("a manifest over a production bundle fails — the check is measured", async () => {
  await withLaneFlag("1", async () => {
    const baseUrl = await serve({
      ...DEV_FILES,
      "/assets/app.js": ["text/javascript", "console.log('production');"],
    });
    await assert.rejects(
      solidDevCheckFor(baseUrl),
      /without Solid's development runtime/,
    );
  });
});

test("any other value of the flag is a caller bug", async () => {
  await withLaneFlag("true", async () => {
    const baseUrl = await serve({ "/": ["text/html; charset=utf-8", SHELL] });
    await assert.rejects(solidDevCheckFor(baseUrl), /must be "1"/);
  });
});

test("a bad flag fails even when the server serves a manifest", async () => {
  await withLaneFlag("0", async () => {
    const baseUrl = await serve(DEV_FILES);
    await assert.rejects(solidDevCheckFor(baseUrl), /must be "1"/);
  });
});

test("the init script subscribes the moment the client hands OBSERVE over", () => {
  const reported: PageDiagnostic[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  const window: Record<string, unknown> = {
    [SOLID_DIAGNOSTIC_BINDING]: (event: PageDiagnostic) => reported.push(event),
  };
  // The script is page source, not a module: run it with its own `window`,
  // which is the only global it touches.
  new Function("window", solidObserveInitScript())(window);
  // Nothing to subscribe to until the client assigns it — the script runs
  // first, so it owns the global and waits.
  assert.equal(listeners.length, 0);
  window.__SOLID_OBSERVE__ = {
    diagnostics: {
      subscribe: (listener: (event: unknown) => void) =>
        listeners.push(listener),
    },
  };
  assert.equal(listeners.length, 1);
  listeners[0]?.({
    sequence: 7,
    code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
    kind: "write",
    severity: "error",
    nodeName: "handle",
    data: { operation: "set" },
    message: "a signal was written in an owned scope",
    loc: "src/conductor/PaletteRow.tsx:372:9",
    ownerPath: ["<App>", "<PaletteRow>"],
  });
  const [got] = reported;
  assert.ok(got);
  // SOLID'S OWN GRADE COMES ACROSS, with the kind, the node's name and the
  // event's data: the judge fails on `error`/`warn` and prints `info`, and it
  // cannot do that from a field the page never forwarded.
  const { stack, ...carried } = got;
  assert.deepEqual(carried, {
    code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
    loc: "src/conductor/PaletteRow.tsx:372:9",
    ownerPath: ["<App>", "<PaletteRow>"],
    message: "a signal was written in an owned scope",
    severity: "error",
    kind: "write",
    nodeName: "handle",
    data: { operation: "set" },
  });
  // The stack is captured inside the subscriber, which Solid calls
  // synchronously inside the read or write that raised the finding — so it
  // names the frame a location-less finding has no other name for.
  assert.equal(typeof stack, "string");
  assert.match(String(stack), /solidDevBuild\.test\.ts/);
});

test("the verdict names each diagnostic, where it was and what threw", () => {
  const verdict = solidDiagnosticVerdict({
    events: [
      {
        code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
        severity: "error",
        loc: "src/conductor/PaletteRow.tsx:372:9",
        ownerPath: ["<App>", "<PaletteRow>"],
        message: "a signal was written in an owned scope",
      },
      // An unowned primitive carries no owner path, and a node compiled
      // without locations no `loc`: neither is printed as `undefined`.
      {
        code: "NO_OWNER_EFFECT",
        severity: "warn",
        message: "an effect with no owner",
      },
    ],
    lines: ["useHead: ignoring invalid attribute name"],
    pageErrors: ["TypeError: x is not a function"],
  });
  assert.equal(verdict?.fails, true);
  assert.equal(
    verdict?.words,
    [
      "Solid dev diagnostics (3):",
      "  [error] REACTIVE_WRITE_IN_OWNED_SCOPE at src/conductor/PaletteRow.tsx:372:9 in <App> > <PaletteRow>: a signal was written in an owned scope",
      "  [warn] NO_OWNER_EFFECT: an effect with no owner",
      "  useHead: ignoring invalid attribute name",
      "the pages threw (1):",
      "  TypeError: x is not a function",
    ].join("\n"),
  );
});

// SOLID'S `info` IS ADVISORY, and this judge says so too: a measurement's
// relay tear — the one corvu-next's own setup passes on — is reported and
// fails nothing.
test("an info finding is printed as advisory and fails nothing", () => {
  const verdict = solidDiagnosticVerdict({
    events: [
      {
        code: "EFFECT_RELAY_TEAR",
        severity: "info",
        loc: "src/layout/RightPanelDrawer.tsx:81:5",
        message: "an effect wrote a value another effect reads",
        scenario: "the drawer opens",
        step: "I open the right panel",
      },
    ],
    lines: [],
    pageErrors: [],
  });
  assert.equal(verdict?.fails, false);
  assert.equal(
    verdict?.words,
    [
      "Solid also graded 1 finding(s) info — advisory, failing nothing:",
      '  [info] EFFECT_RELAY_TEAR at src/layout/RightPanelDrawer.tsx:81:5: an effect wrote a value another effect reads [first in "the drawer opens" at step "I open the right panel"]',
    ].join("\n"),
  );
});

// A RELAY TEAR NAMES THREE NODES AND THE LINE PRINTS ALL THREE. `nodeName` is
// the victim that ran twice; `data.relay` is the effect whose write re-ran it
// and `data.wrote` the value that write landed in. Without the pair, a tear
// inside a library's own measurement and a tear the app causes by writing
// back from inside that measurement's report read identically.
test("a relay tear names the relay and what it wrote", () => {
  const verdict = solidDiagnosticVerdict({
    events: [
      {
        code: "EFFECT_RELAY_TEAR",
        severity: "info",
        nodeName: "div.spread",
        message: "ran twice for one write",
        data: {
          victim: "div.spread",
          root: "selection",
          relay: "rootSize",
          wrote: "codeTabTreeSize",
          copy: false,
          soleWriter: true,
          occurrences: 2,
        },
      },
    ],
    lines: [],
    pageErrors: [],
  });
  assert.equal(verdict?.fails, false);
  assert.match(
    verdict?.words ?? "",
    /EFFECT_RELAY_TEAR \(relay "rootSize", wrote "codeTabTreeSize"\) on "div\.spread"/,
  );
});

// The pair belongs to that one code: another finding's `data` is the
// detector's own census, and printing it would say "relay" where there is
// none.
test("another code's data is not printed as a relay", () => {
  const verdict = solidDiagnosticVerdict({
    events: [
      {
        code: "WIDE_SCOPE_DEPS",
        severity: "warn",
        nodeName: "needsYou",
        data: { relay: "not a relay", wrote: "not a write" },
      },
    ],
    lines: [],
    pageErrors: [],
  });
  assert.equal(verdict?.words.includes("relay"), false);
});

// A tear whose data did not survive the page boundary is printed as it
// stands, rather than as a pair of `undefined`s.
test("a relay tear with no data prints without the pair", () => {
  const verdict = solidDiagnosticVerdict({
    events: [{ code: "EFFECT_RELAY_TEAR", severity: "info", loc: "a.tsx:1:1" }],
    lines: [],
    pageErrors: [],
  });
  assert.equal(
    verdict?.words,
    [
      "Solid also graded 1 finding(s) info — advisory, failing nothing:",
      "  [info] EFFECT_RELAY_TEAR at a.tsx:1:1",
    ].join("\n"),
  );
});

test("a warn finding fails, and carries its info neighbours along", () => {
  const verdict = solidDiagnosticVerdict({
    events: [
      { code: "EFFECT_RELAY_TEAR", severity: "info", loc: "a.tsx:1:1" },
      { code: "EFFECT_RELAY_TEAR", severity: "warn", loc: "b.tsx:2:2" },
    ],
    lines: [],
    pageErrors: [],
  });
  assert.equal(verdict?.fails, true);
  assert.equal(
    verdict?.words,
    [
      "Solid dev diagnostics (1):",
      "  [warn] EFFECT_RELAY_TEAR at b.tsx:2:2",
      "Solid also graded 1 finding(s) info — advisory, failing nothing:",
      "  [info] EFFECT_RELAY_TEAR at a.tsx:1:1",
    ].join("\n"),
  );
});

// `info` IS NOT A BLANKET PASS. Solid grades `EFFECT_WRITES_OWN_SOURCE` by
// cycle length (`links.length === 1 ? "warn" : "info"`,
// `dev.attribution.js:1054`), so a cycle relayed through two effects arrives
// `info` while Solid's own message says "derive them in memos and drop the
// writes". Only an `info` relay tear is advisory; every other code fails.
test("an info finding of another code fails rather than passing", () => {
  const verdict = solidDiagnosticVerdict({
    events: [
      {
        code: "EFFECT_WRITES_OWN_SOURCE",
        severity: "info",
        nodeName: "layout",
        message: "effects relay writes in a cycle",
      },
    ],
    lines: [],
    pageErrors: [],
  });
  assert.equal(verdict?.fails, true);
  assert.equal(
    verdict?.words,
    [
      "Solid dev diagnostics (1):",
      '  [info] EFFECT_WRITES_OWN_SOURCE on "layout": effects relay writes in a cycle',
    ].join("\n"),
  );
});

// A shape this harness does not know is a finding it must not wave through:
// every `emitDiagnostic` in 2.0.4 passes a grade, so a missing one means the
// event lost a field on its way here.
test("a finding with no severity fails rather than passing as advisory", () => {
  const verdict = solidDiagnosticVerdict({
    events: [{ code: "STRICT_READ_UNTRACKED" }],
    lines: [],
    pageErrors: [],
  });
  assert.equal(verdict?.fails, true);
  assert.equal(
    verdict?.words,
    [
      "Solid dev diagnostics (1):",
      "  [(no severity)] STRICT_READ_UNTRACKED",
    ].join("\n"),
  );
});

test("a scenario that raised nothing has no verdict, whatever it threw", () => {
  assert.equal(
    solidDiagnosticVerdict({
      events: [],
      lines: [],
      pageErrors: ["TypeError: x is not a function"],
    }),
    undefined,
  );
});

test("an event is stamped with the scenario and step that were running", () => {
  assert.deepEqual(
    stampDiagnostic(
      { code: "REACTIVE_WRITE_IN_OWNED_SCOPE" },
      { scenario: "the palette opens", step: "I press the palette key" },
    ),
    {
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      scenario: "the palette opens",
      step: "I press the palette key",
    },
  );
  // Before the first step there is nothing to stamp, and `undefined` would
  // read as "stamped, with nothing" in the verdict.
  assert.deepEqual(stampDiagnostic({ code: "NO_OWNER_EFFECT" }, {}), {
    code: "NO_OWNER_EFFECT",
  });
});

test("identical findings fold into one, keeping the first occurrence", () => {
  const at = (scenario: string, step: string) => ({
    code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
    loc: "src/palette/CommandPalette.tsx:88:3",
    ownerPath: ["<App>", "<CommandPalette>"],
    scenario,
    step,
  });
  const folded = foldDiagnostics([
    at("the palette opens", "I press the palette key"),
    at("the palette opens", 'I type "term"'),
    // Same site, a different scenario: still the same finding.
    at("the palette filters", 'I type "x"'),
    // A different location is a different finding, however alike the code.
    { ...at("the palette opens", "I press the palette key"), loc: "x.tsx:1:1" },
  ]);
  assert.deepEqual(
    folded.map((f) => [f.count, f.event.loc, f.event.step]),
    [
      [3, "src/palette/CommandPalette.tsx:88:3", "I press the palette key"],
      [1, "x.tsx:1:1", "I press the palette key"],
    ],
  );
});

// TWO LOCATION-LESS FINDINGS ARE TWO FINDINGS. An apply-arm strict read
// carries neither `loc` nor `ownerPath`, only the name of the value read —
// so without `nodeName` in the key every unnamed site in the app collapses
// into one row, which is how site D stayed unnamed.
test("location-less findings fold apart by the node they name", () => {
  const read = (nodeName: string) => ({
    code: "STRICT_READ_UNTRACKED",
    severity: "warn",
    nodeName,
  });
  assert.deepEqual(
    foldDiagnostics([
      read("isMobile"),
      read("isMobile"),
      read("resizableContext"),
    ]).map((f) => [f.count, f.event.nodeName]),
    [
      [2, "isMobile"],
      [1, "resizableContext"],
    ],
  );
});

// THE STACK IS THE NAME a location-less finding has. It is printed for the
// first occurrence of such a finding, and not for one that already says
// where it is.
test("the verdict prints the first stack for a location-less finding", () => {
  const stack =
    "Error\n    at read (solid-js/dist/dev.js:591:7)\n    at useMobile (src/hooks/useMobile.ts:43:19)";
  const verdict = solidDiagnosticVerdict({
    events: [
      { code: "STRICT_READ_UNTRACKED", severity: "warn", stack },
      {
        code: "STRICT_READ_UNTRACKED",
        severity: "warn",
        stack: "Error\n    at somewhere else",
      },
      {
        code: "UNSTABLE_MEMO_OUTPUT",
        severity: "warn",
        loc: "a.tsx:1:1",
        stack,
      },
    ],
    lines: [],
    pageErrors: [],
  });
  assert.equal(
    verdict?.words,
    [
      "Solid dev diagnostics (3):",
      "  ×2 [warn] STRICT_READ_UNTRACKED",
      "    first raised from:",
      "    at read (solid-js/dist/dev.js:591:7)",
      "    at useMobile (src/hooks/useMobile.ts:43:19)",
      "  [warn] UNSTABLE_MEMO_OUTPUT at a.tsx:1:1",
    ].join("\n"),
  );
});

test("the verdict folds repeats into one line, naming where the first was", () => {
  const raised = {
    code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
    severity: "error",
    loc: "src/palette/CommandPalette.tsx:88:3",
    ownerPath: ["<App>", "<CommandPalette>"],
    message: "a signal was written in an owned scope",
  };
  assert.equal(
    solidDiagnosticVerdict({
      events: [
        {
          ...raised,
          scenario: "the palette opens",
          step: "I press the palette key",
        },
        { ...raised, scenario: "the palette opens", step: 'I type "term"' },
      ],
      lines: [],
      pageErrors: [],
    })?.words,
    [
      "Solid dev diagnostics (2):",
      '  ×2 [error] REACTIVE_WRITE_IN_OWNED_SCOPE at src/palette/CommandPalette.tsx:88:3 in <App> > <CommandPalette>: a signal was written in an owned scope [first in "the palette opens" at step "I press the palette key"]',
    ].join("\n"),
  );
});

test("the headline counts a finding once, not as event AND footer", () => {
  const verdict = solidDiagnosticVerdict({
    events: [{ code: "REACTIVE_WRITE_IN_OWNED_SCOPE", severity: "error" }],
    lines: [],
    // The console footer of that same finding: Solid prints one per code.
    footers: ["what it means and how to fix it: https://…"],
    pageErrors: [],
  });
  assert.equal(
    verdict?.words,
    [
      "Solid dev diagnostics (1):",
      "  [error] REACTIVE_WRITE_IN_OWNED_SCOPE",
      "the console footers behind them (1), each already named as an event above:",
      "  what it means and how to fix it: https://…",
    ].join("\n"),
  );
});

test("a dev-runtime server tells a footer from a plain warning", async () => {
  const baseUrl = await serve(DEV_FILES);
  const check = await solidDevCheckFor(baseUrl);
  assert.ok(check);
  assert.equal(check.isFooter(`[solid] ${MARKER} https://…`), true);
  assert.equal(check.isFooter(`${WARNING}data-x"`), false);
  assert.equal(check.isDiagnostic(`${WARNING}data-x"`), true);
});

test("dev-smoke fails on a Solid diagnostic, not only on a console error", () => {
  assert.deepEqual(
    devSmokeFailures({
      consoleErrors: [],
      pageErrors: [],
      diagnostics: [
        {
          code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
          severity: "error",
          loc: "src/App.tsx:3:1",
        },
        {
          code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
          severity: "error",
          loc: "src/App.tsx:3:1",
        },
      ],
    }),
    {
      failures: [
        "solid diagnostic: ×2 [error] REACTIVE_WRITE_IN_OWNED_SCOPE at src/App.tsx:3:1",
      ],
      advisories: [],
    },
  );
  assert.deepEqual(
    devSmokeFailures({
      consoleErrors: ["boom"],
      pageErrors: ["TypeError: x is not a function"],
      diagnostics: [],
    }),
    {
      failures: [
        "console.error: boom",
        "uncaught: TypeError: x is not a function",
      ],
      advisories: [],
    },
  );
});

// The boot judge grades exactly as the scenario judge does: an `info` finding
// is reported, not a failure, and a `warn` one fails.
test("dev-smoke reports an info finding and fails on a warn one", () => {
  assert.deepEqual(
    devSmokeFailures({
      consoleErrors: [],
      pageErrors: [],
      diagnostics: [
        { code: "EFFECT_RELAY_TEAR", severity: "info", loc: "a.tsx:1:1" },
        { code: "EFFECT_RELAY_TEAR", severity: "warn", loc: "b.tsx:2:2" },
      ],
    }),
    {
      failures: ["solid diagnostic: [warn] EFFECT_RELAY_TEAR at b.tsx:2:2"],
      advisories: ["solid diagnostic: [info] EFFECT_RELAY_TEAR at a.tsx:1:1"],
    },
  );
});
