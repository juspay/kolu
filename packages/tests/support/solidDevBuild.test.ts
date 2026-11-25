import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { solidDevCheckFor } from "./solidDevBuild.ts";

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
    JSON.stringify({ marker: MARKER, warnings: [WARNING] }),
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
