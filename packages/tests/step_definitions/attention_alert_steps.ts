import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { readPadiDirect } from "../support/hooks.ts";
import { pollFor, pollUntil } from "../support/poll.ts";
import { redeployUnderThisPage } from "../support/redeploy.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** What a timed-out unread wait reports, so a red run tells apart padi not
 *  having opened its feed (`settled: false`), a turn that finished with no
 *  mark raised, and a turn that had not finished: padi's own `urgency` read
 *  off its socket, every dock row's agent state, pip, unread mark and active
 *  flag, and whether the page has focus. */
async function attentionDiagnosis(world: KoluWorld): Promise<string> {
  const urgency = await readPadiDirect().then(
    ({ urgency }) => JSON.stringify(urgency),
    (err: unknown) => `unreadable: ${(err as Error).message}`,
  );
  const page = await world.page.evaluate(() => ({
    hasFocus: document.hasFocus(),
    rows: [...document.querySelectorAll('[data-testid="dock-row"]')].map(
      (row) => {
        const pip = row.querySelector('[data-testid="state-pip"]');
        return {
          id: row.getAttribute("data-terminal-id"),
          agent: row.getAttribute("data-agent-state"),
          pip: pip
            ? `${pip.getAttribute("data-pip")}/${pip.getAttribute("data-motion")}`
            : null,
          unread: row.hasAttribute("data-unread"),
          active: row.hasAttribute("data-active"),
        };
      },
    ),
  }));
  return [
    `padi urgency: ${urgency}`,
    `page has focus: ${page.hasFocus}`,
    `dock rows: ${JSON.stringify(page.rows)}`,
  ].join("\n");
}

/** Wait for a dock row matching `selector` to be visible; on timeout, throw
 *  with {@link attentionDiagnosis}. */
async function waitForUnreadRow(
  world: KoluWorld,
  selector: string,
): Promise<void> {
  try {
    await world.page
      .locator(selector)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  } catch (err) {
    throw new Error(
      `${(err as Error).message}\n${await attentionDiagnosis(world)}`,
    );
  }
}

/** kolu is redeployed under the open page: the server and padi are replaced,
 *  the terminals keep running, and the page reloads with its storage — see
 *  `redeployUnderThisPage`. The harness cannot keep a tab open across it (the
 *  new server listens on a new port), so a scenario here is always the
 *  RELOAD half of a restart; the tab that stays open is the unit tests'. */
When(
  "the kolu server is redeployed under this page",
  { timeout: 180_000 },
  async function (this: KoluWorld) {
    await redeployUnderThisPage(this);
  },
);

/** The agent's row shows padi's verdict that its turn is over — still, in
 *  the post-turn paint. padi publishes that verdict only once it has looked,
 *  so a check after this one is a check of what the page did with padi's
 *  first real word, not of a page that has not heard it yet. */
Then(
  "the agent's dock row should show its finished turn",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() =>
          [
            ...document.querySelectorAll(
              '[data-testid="dock-row"][data-agent-state="waiting"] [data-testid="state-pip"]',
            ),
          ].map(
            (pip) =>
              `${pip.getAttribute("data-pip")}/${pip.getAttribute("data-motion")}`,
          ),
        ),
      isDone: (pips) => pips.includes("linger/none"),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (pips, ms) =>
        new Error(
          `after ${ms}ms no waiting agent's row showed a finished turn (pips: ${JSON.stringify(pips)})`,
        ),
    });
  },
);

/** The finished agent's own row carries the unread mark — not merely some
 *  row, so a mark that moved to the wrong terminal does not pass. */
Then("the agent's dock row should be unread", async function (this: KoluWorld) {
  await waitForUnreadRow(
    this,
    '[data-testid="dock-row"][data-agent-state="waiting"][data-unread]',
  );
});

/** The asking agent's row says so — padi lists it as asking, which is what a
 *  check after this one is about. */
Then(
  "the agent's dock row should show it asking",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="dock-row"][data-asking]')
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click the attention alerts toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="attention-alerts-toggle"]');
  await this.waitForFrame();
});

When("I simulate an attention alert", async function (this: KoluWorld) {
  // Use page.evaluate to call the simulate function directly,
  // avoiding command palette navigation complexity.
  await this.page.evaluate(() => {
    window.__koluSimulateAlert?.();
  });
  await this.waitForFrame();
});

When(
  "I simulate an attention alert for the active terminal",
  async function (this: KoluWorld) {
    await this.page.evaluate(() => {
      window.__koluSimulateAlert?.({ target: "active" });
    });
    await this.waitForFrame();
  },
);

When("I simulate the Kolu tab being hidden", async function (this: KoluWorld) {
  await this.page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await this.waitForFrame();
});

When(
  "I simulate the Kolu tab becoming visible",
  async function (this: KoluWorld) {
    await this.page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await this.waitForFrame();
  },
);

/** "Is the person looking?" is half `document.hasFocus()`, and a headless page
 *  cannot be made to lose and regain focus on cue. So the answer is DECLARED
 *  rather than raced — the same override `render_recovery_steps.ts` uses to
 *  model an occluded window. `Boolean.bind(null, x)` is a hasFocus() → x with
 *  no function literal for esbuild's keep-names to decorate. */
When(
  /^I simulate the Kolu window (losing|regaining) focus$/,
  async function (this: KoluWorld, how: string) {
    await this.page.evaluate((focused) => {
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: Boolean.bind(null, focused),
      });
    }, how === "regaining");
  },
);

Then(
  "a workspace switcher branch should be notified",
  async function (this: KoluWorld) {
    await waitForUnreadRow(this, '[data-testid="dock-row"][data-unread]');
  },
);

Then(
  "no workspace switcher branch should be notified",
  async function (this: KoluWorld) {
    // Double frame wait to flush SolidJS reactivity + any pending DOM updates
    await this.waitForFrame();
    await this.waitForFrame();
    const count = await this.page
      .locator('[data-testid="dock-row"][data-unread]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no notified entries, found ${count}`,
    );
  },
);

When(
  "I click the notified workspace switcher branch",
  async function (this: KoluWorld) {
    const notified = this.page.locator('[data-testid="dock-row"][data-unread]');
    await notified.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await notified.first().click();
    await this.waitForFrame();
  },
);

/** Records every badge write instead of making one. Installed on THIS page and
 *  on every page a navigation loads after it, like the sound stub, so a
 *  reload's badge is recorded too. Assigned as properties, so no name is
 *  inferred for esbuild's keep-names to wrap. */
const stubBadge = (): void => {
  window.__badgeCalls = [];
  navigator.setAppBadge = (count?: number) => {
    window.__badgeCalls?.push({ method: "set", count });
    return Promise.resolve();
  };
  navigator.clearAppBadge = () => {
    window.__badgeCalls?.push({ method: "clear" });
    return Promise.resolve();
  };
};

When("I stub the Badging API", async function (this: KoluWorld) {
  await this.page.addInitScript(stubBadge);
  await this.page.evaluate(stubBadge);
});

/** The sound is the one channel a page cannot show, so the step records it
 *  instead: every `play()` on a media element pushes its source onto the
 *  stash and resolves, the way `I stub the Badging API` records the badge.
 *  The `Audio` the app builds is still the real one — only the noise is
 *  replaced. Assigned as a property, so no name is inferred for esbuild's
 *  keep-names to wrap in a `__name(...)` the page does not have. */
const stubSound = (): void => {
  window.__soundPlays = [];
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    // A media element playing a `srcObject` has no `src` to name.
    window.__soundPlays?.push(this.src ? new URL(this.src).pathname : "");
    return Promise.resolve();
  };
};

/** Installed on THIS page and on every page a navigation loads after it, so a
 *  reload is heard too — the new page starts with an empty stash, which is
 *  exactly what "did the reload ring?" needs. */
When("I stub the notification sound", async function (this: KoluWorld) {
  await this.page.addInitScript(stubSound);
  await this.page.evaluate(stubSound);
});

/** EXACTLY this many, not at least: waits for the count to arrive, then gives
 *  the page two more frames to ring a second time it should not have. */
Then(
  "the notification sound should have played {int} time(s)",
  async function (this: KoluWorld, expected: number) {
    // `evaluate` already hands back a serialised copy.
    const read = () => this.page.evaluate(() => window.__soundPlays ?? []);
    await pollFor({
      observe: read,
      isDone: (plays) => plays.length >= expected,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (plays, elapsedMs) =>
        new Error(
          `after ${elapsedMs}ms the notification sound had played ${JSON.stringify(plays)}, wanted ${expected} time(s)`,
        ),
    });
    await this.waitForFrame();
    await this.waitForFrame();
    const plays = await read();
    assert.deepStrictEqual(
      plays,
      Array(expected).fill("/sounds/notification.mp3"),
      `the notification sound played ${JSON.stringify(plays)}, wanted ${expected} time(s)`,
    );
  },
);

Then(
  "the app badge should show {int}",
  async function (this: KoluWorld, expected: number) {
    // POLL: the badge is now the cross-host `urgency` (awaiting-agent) count — a
    // WIRE fact that lands after the agent-state round-trips through padi's fold
    // and the client's watcher, so a single-read assert races the propagation.
    // Wait for the last `set` call to reach the expected count.
    const lastSet = await pollUntil(
      this.page,
      () =>
        this.page.evaluate(() => {
          const calls = window.__badgeCalls ?? [];
          return (
            calls
              .filter(
                (c): c is { method: "set"; count?: number } =>
                  c.method === "set",
              )
              .pop() ?? null
          );
        }),
      (s) => s?.count === expected,
      { attempts: 40, intervalMs: 250 },
    );
    assert.ok(lastSet, "Expected setAppBadge to have been called");
    assert.strictEqual(lastSet.count, expected);
  },
);

Then("the app badge should be cleared", async function (this: KoluWorld) {
  await this.waitForFrame();
  const lastCall = await this.page.evaluate(() => {
    const calls = window.__badgeCalls ?? [];
    return calls[calls.length - 1];
  });
  assert.ok(lastCall, "Expected a badge API call");
  assert.strictEqual(lastCall.method, "clear");
});

/** THE QUIET CLAIM, and the reason it is spelled as "never": the badge is
 *  de-duplicated against the last count it confirmed, so an agent that raises
 *  nothing produces NO call at all — there is no `clear` to find and "the last
 *  call was a clear" would fail on a perfectly quiet app. What a presence
 *  promises is that no count was ever put on the icon for it, which is exactly
 *  the absence of a `set` with a number in it. */
Then(
  "the app badge should never have counted an agent",
  async function (this: KoluWorld) {
    await this.waitForFrame();
    const counted = await this.page.evaluate(() =>
      (window.__badgeCalls ?? [])
        .filter(
          (call): call is { method: "set"; count?: number } =>
            call.method === "set" && (call.count ?? 0) > 0,
        )
        .map((call) => call.count),
    );
    assert.deepStrictEqual(
      counted,
      [],
      `the app badge was raised to ${counted.join(", ")} for an agent that needs nobody`,
    );
  },
);

/** The host tab's two attention marks, both absent: the working STRIPE along
 *  its bottom edge and the count segment beside its name. Scoped under
 *  `host-chip-row` — the hidden measuring twin also matches `host-chip` — and
 *  read off the ACTIVE tab, the one whose terminals the scenario is about. */
Then(
  "the active host tab should show no attention marks",
  async function (this: KoluWorld) {
    await this.waitForFrame();
    const marks = await this.page.evaluate(() => {
      const tab = document.querySelector(
        '[data-testid="host-chip-row"] [data-testid="host-chip"][data-active]',
      );
      if (tab === null) return "no active host tab";
      const found = [
        tab.querySelector('[data-testid="host-tab-working-stripe"]') === null
          ? null
          : "working stripe",
        tab.querySelector('[data-testid="attention-active"]') === null
          ? null
          : "active count",
        tab.querySelector('[data-testid="attention-awaiting"]') === null
          ? null
          : "awaiting count",
      ].filter((mark) => mark !== null);
      return found.join(", ");
    });
    assert.strictEqual(
      marks,
      "",
      `the active host tab carried ${marks} for an agent that needs nobody`,
    );
  },
);
