import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import {
  isPidLive,
  killKavalDaemon,
  readKavalGatePid,
  readPadiGatePid,
} from "../support/hooks.ts";
import {
  identityChipSelector,
  openActiveHostDiagnostics,
} from "../support/hostChip.ts";
import { APP_KEY, type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

async function armWarmingCanvasRecorder(world: KoluWorld): Promise<void> {
  await world.page.evaluate(() => {
    const state = window as unknown as {
      __sawDaemonWarming: boolean;
    };
    state.__sawDaemonWarming = Boolean(
      document.querySelector('[data-testid="daemon-warming"]'),
    );
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="daemon-warming"]')) {
        state.__sawDaemonWarming = true;
        observer.disconnect();
      }
    });
    if (!state.__sawDaemonWarming) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
}

When("I start recording error toasts", async function (this: KoluWorld) {
  // No named function bindings inside evaluate: esbuild's keepNames wraps a
  // `const fn = () => {}` in a `__name(...)` helper that isn't defined in the
  // page context (ReferenceError). Anonymous callbacks passed directly are safe.
  await this.page.evaluate(() => {
    (window as unknown as { __errorToasts: string[] }).__errorToasts = [];
    new MutationObserver(() => {
      const seen = (window as unknown as { __errorToasts: string[] })
        .__errorToasts;
      for (const li of document.querySelectorAll("[data-sonner-toaster] li")) {
        const text = li.textContent?.trim() ?? "";
        if (text && !seen.includes(text)) seen.push(text);
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
});

Then(
  "no {string} error toast should have been shown",
  async function (this: KoluWorld, forbidden: string) {
    const seen = await this.page.evaluate(
      () =>
        (window as unknown as { __errorToasts?: string[] }).__errorToasts ?? [],
    );
    const offending = seen.filter((t) => t.includes(forbidden));
    assert.deepStrictEqual(
      offending,
      [],
      `Expected no toast containing "${forbidden}", but saw: ${JSON.stringify(
        offending,
      )} (all toasts: ${JSON.stringify(seen)})`,
    );
  },
);

Then(
  "the restored split sub-terminal should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator("[data-sub-terminal][data-visible]")
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("the kaval daemon is killed", async function (this: KoluWorld) {
  const pid = killKavalDaemon();
  if (pid === undefined) {
    throw new Error(
      "no kaval daemon to kill — the server should have spawned one at boot",
    );
  }
});

When(
  "I capture the padi and kaval daemon pids",
  async function (this: KoluWorld) {
    this.capturedPadiPid = readPadiGatePid();
    this.capturedKavalPid = readKavalGatePid();
    if (this.capturedPadiPid === undefined) {
      throw new Error(
        "no padi gate pid to capture — the server should have spawned padi at boot",
      );
    }
  },
);

When("I open the kaval rail dialog", async function (this: KoluWorld) {
  await openActiveHostDiagnostics(this.page);
  await this.page.locator(identityChipSelector("kaval-identity-chip")).click();
  await this.page.waitForSelector('[data-testid="restart-kaval"]', {
    timeout: POLL_TIMEOUT,
  });
});

Then(
  "the running-daemons list shows one group with the live kaval, no duplicate local group",
  async function (this: KoluWorld) {
    const boundHost = this.page.locator(
      '[data-testid="kaval-bound-host-daemons"]',
    );
    await boundHost.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await boundHost
      .getByRole("heading", { name: "Running kaval daemons" })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await boundHost
      .getByText("in use by kolu")
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await this.page
        .locator('[data-testid="kaval-local-scan-daemons"]')
        .count(),
      0,
      "a local binding must show ONE daemon group, not a duplicate 'this machine' group",
    );
  },
);

When("I restart kaval from the rail dialog", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="restart-kaval"]').click();
  await armWarmingCanvasRecorder(this);
  await this.page.locator('[data-testid="restart-kaval-confirm"]').click();
});

Then(
  "the kaval daemon has been recycled with a fresh pid",
  async function (this: KoluWorld) {
    if (this.capturedKavalPid === undefined) {
      throw new Error(
        "no captured kaval pid — run 'I capture the padi and kaval daemon pids' first",
      );
    }
    let current: number | undefined;
    const deadline = Date.now() + POLL_TIMEOUT;
    do {
      current = readKavalGatePid();
      if (current !== undefined && current !== this.capturedKavalPid) break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < deadline);
    if (current === undefined || current === this.capturedKavalPid) {
      throw new Error(
        `kaval was NOT recycled — gate pid is still ${String(current)} ` +
          `(captured ${this.capturedKavalPid}); a stuck-but-alive kaval must be ` +
          "killed + respawned, not adopted",
      );
    }
    if (!isPidLive(current)) {
      throw new Error(
        `the recycled kaval's gate pid ${current} names no live process`,
      );
    }
  },
);

Then("the padi daemon pid is unchanged", async function (this: KoluWorld) {
  if (this.capturedPadiPid === undefined) {
    throw new Error(
      "no captured padi pid — run 'I capture the padi and kaval daemon pids' first",
    );
  }
  const current = readPadiGatePid();
  if (current !== this.capturedPadiPid) {
    throw new Error(
      `padi was restarted (gate pid ${String(current)} != captured ` +
        `${this.capturedPadiPid}) — recycleKaval must recycle KAVAL, not padi`,
    );
  }
  if (!isPidLive(this.capturedPadiPid)) {
    throw new Error(
      `padi gate pid ${this.capturedPadiPid} names no live process — padi ` +
        "must stay up across a kaval recycle",
    );
  }
});

Then("the degraded canvas is shown", async function (this: KoluWorld) {
  await this.page.waitForSelector('[data-testid="degraded-canvas"]', {
    timeout: POLL_TIMEOUT,
  });
});

When(
  "I restart kaval from the degraded canvas",
  async function (this: KoluWorld) {
    await this.page.locator('[data-testid="restart-kaval"]').click();
    await armWarmingCanvasRecorder(this);
    await this.page.locator('[data-testid="restart-kaval-confirm"]').click();
  },
);

Then(
  "the warming canvas is shown while kaval restarts",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () =>
        (window as unknown as { __sawDaemonWarming?: boolean })
          .__sawDaemonWarming === true,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the restore card is not offered until kaval is connected",
  async function (this: KoluWorld) {
    const leaked = await this.page.evaluate(() => {
      const warming = document.querySelector('[data-testid="daemon-warming"]');
      const restore = document.querySelector('[data-testid="restore-session"]');
      return Boolean(warming && restore);
    });
    if (leaked) {
      throw new Error(
        "restore card was reachable while kaval was still warming — it must " +
          "be gated until the daemon is connected (F3)",
      );
    }
  },
);

When(
  "I press the create terminal shortcut while kaval restarts",
  async function (this: KoluWorld) {
    await this.page.keyboard.press(`${APP_KEY}+t`);
  },
);

Then(
  "no terminal is created while kaval is warming",
  async function (this: KoluWorld) {
    const leaked = await this.page.evaluate(() => {
      const warming = document.querySelector('[data-testid="daemon-warming"]');
      const tile = document.querySelector('[data-testid="canvas-tile"]');
      return Boolean(warming && tile);
    });
    if (leaked) {
      throw new Error(
        "a terminal was created via the keyboard shortcut while kaval was " +
          "still warming — the create chokepoint must refuse until the " +
          "daemon is connected (F3)",
      );
    }
  },
);

Then("the daemon returns to running", async function (this: KoluWorld) {
  await openActiveHostDiagnostics(this.page);
  await this.page.waitForSelector(
    '[data-testid="host-diagnostics-popover"] [data-daemon-state="connected"]',
    { timeout: 45_000 },
  );
});
