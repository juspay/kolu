import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

When("I open the app", async function (this: KoluWorld) {
  await this.page.goto("/");
});

When("I open {string}", async function (this: KoluWorld, path: string) {
  await this.page.goto(path);
});

When("I request {string}", async function (this: KoluWorld, path: string) {
  const resp = await this.page.request.get(path);
  this.lastResponseOk = resp.ok();
  this.lastResponseText = await resp.text();
});

Then(
  "the current URL path should be {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForURL(`**${expected}`);
    assert.strictEqual(new URL(this.page.url()).pathname, expected);
  },
);

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
  "the page should contain {string}",
  async function (this: KoluWorld, text: string) {
    await this.page.waitForFunction(
      (expected) => document.body.textContent?.includes(expected) ?? false,
      text,
    );
    const content = await this.page.locator("body").textContent();
    assert.ok(
      content?.includes(text),
      `Page content "${content}" does not contain "${text}"`,
    );
  },
);

Then(
  "the page should have a link to {string}",
  async function (this: KoluWorld, href: string) {
    const link = this.page.locator(`a[href="${href}"]`);
    await link.waitFor({ state: "visible" });
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
