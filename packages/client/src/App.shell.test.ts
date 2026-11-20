/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve via `fileURLToPath(import.meta.url)` + `node:path` (not `new URL(…,
// import.meta.url)`): under the `happy-dom` test env the GLOBAL `URL` is the
// browser one, which rejects a `file:` base — so build the path from the module's
// own file URL instead.
const APP_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "App.tsx"),
  "utf8",
);
const RESOLVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "kaval/canvasModeResolver.ts"),
  "utf8",
);

const REACTIVE_PRIMITIVE_BUDGET = 2;

describe("App.tsx thin-shell invariant (#1340)", () => {
  it(`holds at most ${REACTIVE_PRIMITIVE_BUDGET} reactive primitives`, () => {
    const matches =
      APP_SRC.match(
        /\bcreate(Signal|Memo|Effect|Store|Resource)\s*[(<]|\bmakePersisted\s*\(/g,
      ) ?? [];
    expect(matches.length).toBeLessThanOrEqual(REACTIVE_PRIMITIVE_BUDGET);
  });
});

describe("App canvas <Switch> covers every CanvasMode kind (#1763 — no blank fallback)", () => {
  const kinds = [
    ...new Set(
      [...RESOLVER_SRC.matchAll(/kind:\s*"([a-z-]+)"/g)].map((m) => m[1]),
    ),
  ];

  it("finds the non-trivial kind set (guards the extraction itself)", () => {
    expect(kinds).toEqual(
      expect.arrayContaining([
        "connecting",
        "boot-stalled",
        "workspace",
        "empty",
        "down",
        "host-failed",
        "warming",
      ]),
    );
  });

  it.each(kinds)("App wires a <Match>/narrowing for the %s kind", (kind) => {
    expect(APP_SRC).toContain(`=== "${kind}"`);
  });

  it("routes the boot-stalled kind specifically to <BootStalledCanvas>", () => {
    expect(APP_SRC).toMatch(/bootStalledRecovery\(\)/);
    expect(APP_SRC).toContain("<BootStalledCanvas");
  });
});
