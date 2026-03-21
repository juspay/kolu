import { When, Then } from "@cucumber/cucumber";
import { KoluWorld } from "../support/world.ts";
import * as assert from "node:assert";

When("I open the app", async function (this: KoluWorld) {
  await this.page.goto("/");
});

When("I request {string}", async function (this: KoluWorld, path: string) {
  const resp = await this.page.request.get(path);
  this.lastResponseOk = resp.ok();
  this.lastResponseText = await resp.text();
});

Then(
  "the header should contain {string}",
  async function (this: KoluWorld, text: string) {
    const header = this.page.locator("header");
    await header.waitFor({ state: "visible" });
    const content = await header.textContent();
    assert.ok(
      content?.includes(text),
      `Header "${content}" does not contain "${text}"`,
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
