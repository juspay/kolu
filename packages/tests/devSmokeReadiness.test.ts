import assert from "node:assert/strict";
import { test } from "node:test";
import {
  devSmokeJustArgs,
  scanKoluListeningOutput,
} from "./devSmokeReadiness.ts";

test("the CI smoke reuses its completed workspace install", () => {
  assert.deepEqual(devSmokeJustArgs({ server: 43_210, client: 43_211 }), [
    "--no-deps",
    "dev",
    "43210",
    "43211",
  ]);
});

test("a recipe echo and wrong-port banner cannot prove server ownership", () => {
  const expectedPort = 43_210;
  const scan = scanKoluListeningOutput(
    "",
    [
      `→ server http://localhost:${expectedPort}`,
      'info: kolu listening {"address":"http://127.0.0.1:7681"}',
      "",
    ].join("\n"),
    expectedPort,
  );

  assert.equal(scan.ownsPort, false);
});

test("a split listening line proves ownership only after its newline", () => {
  const expectedPort = 43_210;
  const first = scanKoluListeningOutput(
    "",
    'info: kolu listening {"address":"http://127.0.0.1:',
    expectedPort,
  );
  assert.equal(first.ownsPort, false);

  const second = scanKoluListeningOutput(
    first.trailingPartialLine,
    `${expectedPort}"}\n`,
    expectedPort,
  );
  assert.equal(second.ownsPort, true);
});
