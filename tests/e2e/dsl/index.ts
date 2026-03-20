/**
 * E2E DSL entry point.
 *
 * Usage in tests:
 *   import { scenario } from './dsl';
 *   scenario('my test', async ({ app }) => { ... });
 */

import { test } from '@playwright/test';
import { AppViewImpl } from './terminal';
import type { ScenarioContext, ScenarioOptions } from './types';

export type { TerminalView, AppView, ScenarioContext } from './types';

/**
 * Define an e2e scenario.
 *
 * Navigates to /, constructs the AppView, and passes it to the body.
 * All page errors are collected automatically.
 */
export function scenario(
  name: string,
  body: (ctx: ScenarioContext) => Promise<void>,
  opts?: ScenarioOptions,
) {
  const fn = async ({ page }: { page: import('@playwright/test').Page }) => {
    const app = new AppViewImpl(page);
    await page.goto('/');
    await app.terminal.waitForReady();
    await body({ app });
  };

  if (opts?.timeout) {
    test(name, { timeout: opts.timeout }, fn);
  } else {
    test(name, fn);
  }
}
