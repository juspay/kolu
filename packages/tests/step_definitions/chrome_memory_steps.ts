import * as assert from "node:assert";
import { Then } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

/** Each rail column's memory readout carries its own `data-testid` and renders a
 *  compact whole-MB string (e.g. "142 MB"). The figure only appears once a real
 *  value lands — server/client are present immediately under Chromium; kaval
 *  fills in once the daemon's first `system.processMemory` poll returns.
 *
 *  The compact rail keeps these figures out of the always-visible row, so the
 *  test waits for an attached telemetry node rather than a visible chip. */
async function assertMemoryReadout(
  world: KoluWorld,
  testid: string,
): Promise<void> {
  const readout = world.page.locator(`[data-testid="${testid}"]`);
  await readout.waitFor({ state: "attached", timeout: 15_000 });
  const text = await readout.textContent();
  assert.ok(
    text && /\d+\s*MB/.test(text),
    `Rail readout "${testid}" should show a MB figure, got ${JSON.stringify(text)}`,
  );
}

Then(
  "the identity rail details include server memory usage",
  async function (this: KoluWorld) {
    await assertMemoryReadout(this, "server-memory");
  },
);

Then(
  "the identity rail details include client memory usage",
  async function (this: KoluWorld) {
    await assertMemoryReadout(this, "client-memory");
  },
);

Then(
  "the identity rail details include kaval memory usage",
  async function (this: KoluWorld) {
    await assertMemoryReadout(this, "kaval-memory");
  },
);
