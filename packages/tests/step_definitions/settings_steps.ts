import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

When("I click the settings button", async function (this: KoluWorld) {
  await this.page.click('[data-testid="settings-trigger"]');
  await this.waitForFrame();
});

Then(
  "the settings popover should be visible",
  async function (this: KoluWorld) {
    const popover = this.page.locator('[data-testid="settings-popover"]');
    await popover.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the settings popover should not be visible",
  async function (this: KoluWorld) {
    const popover = this.page.locator('[data-testid="settings-popover"]');
    await popover.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the {string} new terminal theme button",
  async function (this: KoluWorld, mode: string) {
    await this.page.click(`[data-testid="new-terminal-theme-${mode}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the {string} new terminal theme button should be selected",
  async function (this: KoluWorld, mode: string) {
    // aria-pressed flips asynchronously after the click (local preference
    // patch → SolidJS reactivity flush → DOM update), so poll rather than
    // read once — a synchronous assertion here races on slower machines.
    await this.page.waitForFunction(
      (m) =>
        document
          .querySelector(`[data-testid="new-terminal-theme-${m}"]`)
          ?.getAttribute("aria-pressed") === "true",
      mode,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I choose {string} for the Conductor's compaction point",
  async function (this: KoluWorld, choice: string) {
    await this.page.click(`[data-testid="conductor-compacts-at-${choice}"]`);
    await this.waitForFrame();
  },
);

When(
  "I enter {string} as the Conductor's custom compaction point",
  async function (this: KoluWorld, thousands: string) {
    const field = this.page.locator(
      '[data-testid="conductor-compacts-at-field"]',
    );
    await field.fill(thousands);
    await field.press("Enter");
    await this.waitForFrame();
  },
);

Then(
  "{string} should be the Conductor's compaction point",
  async function (this: KoluWorld, choice: string) {
    // Polled for the reason the new-terminal-theme step above is: the
    // segment's aria-pressed flips after the preference patch lands.
    await this.page.waitForFunction(
      (c) =>
        document
          .querySelector(`[data-testid="conductor-compacts-at-${c}"]`)
          ?.getAttribute("aria-pressed") === "true",
      choice,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the Conductor's custom compaction point should read {string}",
  async function (this: KoluWorld, thousands: string) {
    await this.page.waitForFunction(
      (t) =>
        document.querySelector<HTMLInputElement>(
          '[data-testid="conductor-compacts-at-field"]',
        )?.value === t,
      thousands,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the {string} shuffle behaviour button",
  async function (this: KoluWorld, mode: string) {
    await this.page.click(`[data-testid="shuffle-behavior-${mode}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the {string} shuffle behaviour button should be selected",
  async function (this: KoluWorld, mode: string) {
    await this.page.waitForFunction(
      (m) =>
        document
          .querySelector(`[data-testid="shuffle-behavior-${m}"]`)
          ?.getAttribute("aria-pressed") === "true",
      mode,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the {string} color scheme button",
  async function (this: KoluWorld, scheme: string) {
    await this.page.click(`[data-testid="color-scheme-${scheme}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the color scheme should be {string}",
  async function (this: KoluWorld, scheme: string) {
    const active = this.page.locator(`[data-testid="color-scheme-${scheme}"]`);
    // The active button gets bg-accent — verify it's present via class check would be fragile;
    // instead verify the html element's class reflects the resolved scheme.
    if (scheme === "dark") {
      await this.page.waitForFunction(() =>
        document.documentElement.classList.contains("dark"),
      );
    } else if (scheme === "light") {
      await this.page.waitForFunction(
        () => !document.documentElement.classList.contains("dark"),
      );
    }
    // Verify the button is rendered (scheme option exists)
    await active.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
