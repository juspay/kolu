import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { OMP_HEARD_MARKER, OMP_UP_MARKER } from "../support/agent-mock-omp.ts";
import { readBufferText } from "../support/buffer.ts";
import {
  type ConductorScreen,
  expectLiveAtBottom,
  expectStaysScrolledBack,
  wheelOver,
} from "../support/conductorScroll.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const PEEK = '[data-testid="terminal-peek"]';
const SCREEN = '[data-testid="peek-screen"]';
const LOCK = `${PEEK} [data-testid="peek-lock"]`;
const CARD = `${PEEK} [data-testid="work-lock-card"]`;

const BLOCKED_WINDOW_MS = 3_000;

function peekScreen(world: KoluWorld): Promise<string> {
  return readBufferText(world.page, SCREEN);
}

async function waitForCount(
  world: KoluWorld,
  selector: string,
  count: number,
): Promise<void> {
  await pollFor({
    observe: () => world.page.locator(selector).count(),
    isDone: (seen) => seen === count,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last) =>
      new Error(`${selector} matched ${last}, expected ${count}`),
  });
}

Then("the peek should be open", async function (this: KoluWorld) {
  await this.page.locator(PEEK).waitFor({
    state: "visible",
    timeout: POLL_TIMEOUT,
  });
});

Then("the peek should not be open", async function (this: KoluWorld) {
  await waitForCount(this, PEEK, 0);
});

Then(
  "the peek should show {string}",
  async function (this: KoluWorld, text: string) {
    await pollFor({
      observe: () => peekScreen(this),
      isDone: (seen) => seen.includes(text),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the peek never showed ${JSON.stringify(text)}; after ${ms}ms its screen reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

When("I note the size the terminal printed", async function (this: KoluWorld) {
  const screen = await readBufferText(this.page);
  const match = screen.match(/size-(\d+x\d+)/);
  assert.ok(
    match !== null,
    `the terminal printed no size; its screen reads ${JSON.stringify(screen.trim().slice(-300))}`,
  );
  this.peekNotedSize = match[1];
});

Then(
  "the peek should show the noted size after {string}",
  async function (this: KoluWorld, prefix: string) {
    assert.ok(this.peekNotedSize, "no terminal size was noted");
    const wanted = `${prefix}${this.peekNotedSize}`;
    await pollFor({
      observe: () => peekScreen(this),
      isDone: (seen) => seen.includes(wanted),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the peek never showed ${JSON.stringify(wanted)}; after ${ms}ms its screen reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

When("I click the peek's terminal", async function (this: KoluWorld) {
  await this.page.locator(SCREEN).click();
});

When("I click the peek's bar", async function (this: KoluWorld) {
  await this.page
    .locator('[data-testid="peek-statusline"]')
    .click({ position: { x: 5, y: 5 } });
});

When(
  "I type {string} into the peek",
  async function (this: KoluWorld, text: string) {
    await this.page.locator(`${SCREEN} .xterm-helper-textarea`).focus();
    await this.page.keyboard.type(text);
    await this.page.keyboard.press("Enter");
  },
);

When(
  "I type {string} on the keyboard",
  async function (this: KoluWorld, text: string) {
    await this.page.keyboard.type(text);
    await this.page.keyboard.press("Enter");
  },
);

Then(
  "the peek should offer to take over the {string}",
  async function (this: KoluWorld, role: string) {
    await pollFor({
      observe: async () => {
        const card = this.page.locator(CARD).last();
        if (!(await card.isVisible().catch(() => false))) return "";
        return ((await card.textContent()) ?? "").replace(/\s+/g, " ").trim();
      },
      isDone: (seen) => seen.includes(role),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the peek never offered to take over the ${role} after ${ms}ms; its card read ${JSON.stringify(last)}`,
        ),
    });
  },
);

When("I take over from the peek's card", async function (this: KoluWorld) {
  await this.page.locator(`${CARD} [data-testid="work-take-over"]`).click();
});

Then(
  "the peek should list {int} tab(s)",
  async function (this: KoluWorld, count: number) {
    await waitForCount(this, `${PEEK} [data-testid="peek-tab"]`, count);
  },
);

async function waitForDriver(
  world: KoluWorld,
  driver: "conductor" | "you",
): Promise<void> {
  await pollFor({
    observe: () =>
      world.page
        .locator(LOCK)
        .last()
        .getAttribute("data-driver", { timeout: 500 })
        .catch(() => null),
    isDone: (seen) => seen === driver,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the peek said ${JSON.stringify(last)} after ${ms}ms, expected ${JSON.stringify(driver)}`,
      ),
  });
}

Then(
  "the peek should say the Conductor is driving",
  async function (this: KoluWorld) {
    await waitForDriver(this, "conductor");
  },
);

Then("the peek should say you are driving", async function (this: KoluWorld) {
  await waitForDriver(this, "you");
});

Then(
  "the peek should carry no hand-back pill",
  async function (this: KoluWorld) {
    await waitForCount(this, `${PEEK} [data-testid="work-hand-back"]`, 0);
  },
);

When("I take over from the peek", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="peek-take-over"]').click();
});

When("I hand back from the peek", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="peek-hand-back"]').click();
});

Then(
  "the peek's terminal should have come up",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () => peekScreen(this),
      isDone: (seen) => seen.includes(OMP_UP_MARKER),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the peek's terminal never came up after ${ms}ms; its screen reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

Then(
  "the peek should have heard {string}",
  async function (this: KoluWorld, text: string) {
    const wanted = `${OMP_HEARD_MARKER} ${text}`;
    await pollFor({
      observe: () => peekScreen(this),
      isDone: (seen) => seen.includes(wanted),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the peek never heard ${JSON.stringify(text)} after ${ms}ms; its screen reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

Then(
  "the peek should not have heard {string}",
  async function (this: KoluWorld, text: string) {
    const deadline = Date.now() + BLOCKED_WINDOW_MS;
    for (;;) {
      const screen = await peekScreen(this);
      if (screen.includes(text)) {
        throw new Error(
          `the lock let ${JSON.stringify(text)} through; the peek's screen reads ${JSON.stringify(screen.trim().slice(-300))}`,
        );
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
);

When("I close the peek", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="peek-close"]').click();
});

When("I open the peeked terminal's tile", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="peek-open-tile"]').click();
});

When(
  "I tap the peek's key {string}",
  async function (this: KoluWorld, key: string) {
    await this.page.locator(`${PEEK} [data-testid="mobile-key-${key}"]`).tap();
    await this.waitForFrame();
  },
);

Then("the peek should carry the key bar", async function (this: KoluWorld) {
  await this.page.locator(`${PEEK} [data-testid="mobile-key-bar"]`).waitFor({
    state: "visible",
    timeout: POLL_TIMEOUT,
  });
});

Then("the peek should carry no key bar", async function (this: KoluWorld) {
  await waitForCount(this, `${PEEK} [data-testid="mobile-key-bar"]`, 0);
});

When("I note where the peek's top bar is", async function (this: KoluWorld) {
  const box = await this.page
    .locator('[data-testid="peek-head"]')
    .boundingBox();
  assert.ok(box !== null, "the peek's top bar had no box");
  this.peekBar = { x: box.x, y: box.y, width: box.width };
  this.peekGrid =
    (await this.page.locator('[data-testid="peek-grid"]').textContent()) ?? "";
});

When("I switch to the peek's other tab", async function (this: KoluWorld) {
  const inactive = this.page.locator(
    `${PEEK} [data-testid="peek-tab"]:not([data-active])`,
  );
  const ref = await inactive.first().getAttribute("data-ref");
  await inactive.first().click();
  await pollFor({
    observe: () =>
      this.page
        .locator(`${PEEK} [data-testid="peek-tab"][data-active]`)
        .first()
        .getAttribute("data-ref"),
    isDone: (seen) => seen === ref,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the tab ${JSON.stringify(ref)} did not become active after ${ms}ms (active was ${JSON.stringify(last)})`,
      ),
  });
});

Then(
  "the peek's terminal should be a different size",
  async function (this: KoluWorld) {
    const before = this.peekGrid;
    assert.ok(before, "no grid was noted before switching");
    await pollFor({
      observe: () =>
        this.page.locator('[data-testid="peek-grid"]').textContent(),
      isDone: (seen) => seen !== null && seen !== before,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `both terminals are ${JSON.stringify(before)} after ${ms}ms (now ${JSON.stringify(last)}), so this check proved nothing`,
        ),
    });
  },
);

Then(
  "the peek's top bar should not have moved",
  async function (this: KoluWorld) {
    const before = this.peekBar;
    assert.ok(before, "no top bar was noted before switching");
    const box = await this.page
      .locator('[data-testid="peek-head"]')
      .boundingBox();
    assert.ok(box !== null, "the peek's top bar had no box");
    const round = (n: number) => Math.round(n);
    assert.deepStrictEqual(
      { x: round(box.x), y: round(box.y), width: round(box.width) },
      { x: round(before.x), y: round(before.y), width: round(before.width) },
      "the peek's top bar moved when the terminal in it changed size",
    );
  },
);

/** THE PEEK'S SCREEN, ITS HEAD'S READOUT AND THE HEAD'S OWN WORDS, for the
 *  scroll-back steps. */
const SCROLLING: ConductorScreen = {
  screen: SCREEN,
  readout: `${PEEK} [data-testid="peek-live"]`,
  status: `${PEEK} [data-testid="peek-status"]`,
  label: "the peek",
};

When("I wheel back over the peek", async function (this: KoluWorld) {
  await wheelOver(this.page, SCROLLING, -500);
});

When("I wheel to the bottom of the peek", async function (this: KoluWorld) {
  await wheelOver(this.page, SCROLLING, 20_000);
});

Then("the peek should stay scrolled back", async function (this: KoluWorld) {
  await expectStaysScrolledBack(this.page, SCROLLING);
});

Then("the peek should be live at the bottom", async function (this: KoluWorld) {
  await expectLiveAtBottom(this.page, SCROLLING);
});
