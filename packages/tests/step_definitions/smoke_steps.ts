import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import type { KoluWorld } from "../support/world.ts";

When("I open the app", async function (this: KoluWorld) {
  await this.page.goto("/");
  await this.page
    .evaluate(() => navigator.clipboard?.writeText?.(""))
    .catch(() => undefined);
});

When("I request {string}", async function (this: KoluWorld, path: string) {
  const resp = await this.page.request.get(path);
  this.lastResponseOk = resp.ok();
  this.lastResponseText = await resp.text();
});

Then(
  "the canvas watermark should contain {string}",
  async function (this: KoluWorld, text: string) {
    const watermark = this.page.locator('[data-testid="canvas-watermark"]');
    await watermark.waitFor({ state: "visible" });
    const content = await watermark.textContent();
    assert.ok(
      content?.includes(text),
      `Watermark "${content}" does not contain "${text}"`,
    );
  },
);

Then(
  "the response should be {string}",
  async function (this: KoluWorld, expected: string) {
    assert.ok(this.lastResponseOk, "Response was not OK");
    assert.strictEqual(this.lastResponseText, expected);
  },
);

Then(
  "the connection status should be {string}",
  async function (this: KoluWorld, expected: string) {
    const indicator = this.page.locator("[data-ws-status]");
    await indicator.waitFor({ state: "visible" });
    const status = await indicator.getAttribute("data-ws-status");
    assert.strictEqual(
      status,
      expected,
      `Expected WS status "${expected}" but got "${status}"`,
    );
  },
);
