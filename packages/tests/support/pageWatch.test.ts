/**
 * The scenario watcher's wiring, driven the way Playwright drives it: the
 * context emits `page` for `newPage()` itself, BEFORE the world's page is
 * assigned, and again for a window the app opens.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { type PageReports, watchContextPages } from "./pageWatch.ts";
import type { SolidDevCheck } from "./solidDevBuild.ts";

/** A page that reports: Playwright's `url()` plus its event emitter. */
class StubPage extends EventEmitter {
  constructor(private readonly href: string) {
    super();
  }
  url(): string {
    return this.href;
  }
  throws(message: string): void {
    this.emit("pageerror", { message });
  }
  says(text: string): void {
    this.emit("console", { text: () => text });
  }
}

/** A dev-runtime server's console check: one diagnostic string, one footer. */
const check: SolidDevCheck = {
  isDiagnostic: (text) => text.startsWith("[REACTIVITY_HALTED]"),
  isFooter: (text) => text.includes("how to fix it:"),
};

/** A context that holds `open` already — what a persistent context hands back
 *  — and emits `page` for every document opened after. */
class StubContext extends EventEmitter {
  constructor(private readonly open: StubPage[] = []) {
    super();
  }
  pages(): StubPage[] {
    return this.open;
  }
}

function harness(opts: { open?: StubPage[]; devRuntime?: boolean } = {}): {
  context: StubContext;
  reports: PageReports;
  setScenarioPage: (page: unknown) => void;
} {
  const context = new StubContext(opts.open ?? []);
  const reports: PageReports = { errors: [], diagnostics: [], footers: [] };
  let scenarioPage: unknown;
  watchContextPages({
    context,
    scenarioPage: () => scenarioPage,
    check: (opts.devRuntime ?? true) ? check : undefined,
    reports,
  });
  return {
    context,
    reports,
    setScenarioPage: (page) => {
      scenarioPage = page;
    },
  };
}

test("two throws on the scenario page are two entries, not four", () => {
  const { context, reports, setScenarioPage } = harness();
  const page = new StubPage("http://localhost:1234/");
  // `newPage()` emits the event while it is still running: the world's page is
  // assigned only once it resolves.
  context.emit("page", page);
  setScenarioPage(page);

  page.throws("first boom");
  page.throws("second boom");

  assert.deepEqual(reports.errors, ["first boom", "second boom"]);
});

test("the scenario page's console lines are recorded once, unlabelled", () => {
  const { context, reports, setScenarioPage } = harness();
  const page = new StubPage("http://localhost:1234/");
  context.emit("page", page);
  setScenarioPage(page);

  page.says("[REACTIVITY_HALTED] Update ignored");
  page.says("[REACTIVITY_HALTED] what it means and how to fix it: https://x");
  page.says("just a log line");

  assert.deepEqual(reports.diagnostics, ["[REACTIVITY_HALTED] Update ignored"]);
  assert.deepEqual(reports.footers, [
    "[REACTIVITY_HALTED] what it means and how to fix it: https://x",
  ]);
});

test("a window the page opens is named by where it came from", () => {
  const { context, reports, setScenarioPage } = harness();
  const page = new StubPage("http://localhost:1234/");
  context.emit("page", page);
  setScenarioPage(page);
  const popup = new StubPage("http://localhost:1234/reader");
  context.emit("page", popup);

  page.throws("main boom");
  popup.throws("reader boom");
  popup.says("[REACTIVITY_HALTED] Update ignored");

  assert.deepEqual(reports.errors, [
    "main boom",
    "http://localhost:1234/reader: reader boom",
  ]);
  assert.deepEqual(reports.diagnostics, [
    "http://localhost:1234/reader: [REACTIVITY_HALTED] Update ignored",
  ]);
});

test("without a dev-runtime check, console lines are not collected", () => {
  const { context, reports, setScenarioPage } = harness({ devRuntime: false });
  const page = new StubPage("http://localhost:1234/");
  context.emit("page", page);
  setScenarioPage(page);

  page.says("[REACTIVITY_HALTED] Update ignored");
  page.throws("boom");

  assert.deepEqual(reports.diagnostics, []);
  assert.deepEqual(reports.errors, ["boom"]);
});

test("a page the context already holds is watched once", () => {
  // The app-mode recordings: Chrome opens its window at launch, so the page
  // exists before anything subscribes and never arrives as a `page` event.
  const page = new StubPage("http://localhost:1234/");
  const { reports, setScenarioPage } = harness({ open: [page] });
  setScenarioPage(page);

  page.throws("boom");
  page.says("[REACTIVITY_HALTED] Update ignored");

  assert.deepEqual(reports.errors, ["boom"]);
  assert.deepEqual(reports.diagnostics, ["[REACTIVITY_HALTED] Update ignored"]);
});
