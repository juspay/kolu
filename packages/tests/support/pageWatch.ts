/**
 * **What every document of a scenario reports, collected once.**
 *
 * A scenario has more than one document: its own page, and any window the app
 * opens (the reader popped out). Both report through the same two channels —
 * an uncaught throw, and on a dev-runtime server a console line that is a
 * Solid dev diagnostic or warning — and the After hook fails the scenario on
 * the first of either.
 *
 * ONE LISTENER, ON THE CONTEXT. Playwright emits `page` for `newPage()` as
 * well as for a window the app opens
 * (`playwright-core/lib/client/browserContext.js`), so the context listener
 * already sees the scenario's own page: subscribing to that page a second time
 * would record each of its throws and diagnostics twice, doubling the counts
 * the verdict reports.
 *
 * LABELLED AT RECORD TIME, NOT WIRE TIME. The world's page is assigned when
 * `newPage()` RESOLVES, and the event fires while it is still running, so the
 * scenario's own page is not yet identifiable when its listeners are
 * installed. Asking at record time is what keeps the main page's lines
 * unlabelled and names the others by where they came from.
 */

import type { SolidDevCheck } from "./solidDevBuild.ts";

/** The part of Playwright's `Page` this watcher uses: its URL, and the two
 *  events a document reports through. Structural, so a test can drive the
 *  wiring with a stub. A thrown error carries `stack` when the page's own
 *  frames are known — the message alone names nothing. */
export interface WatchedPage {
  url(): string;
  on(
    event: "pageerror",
    handler: (error: { message: string; stack?: string }) => void,
  ): unknown;
  on(event: "console", handler: (message: { text(): string }) => void): unknown;
}

/** The part of Playwright's `BrowserContext` this watcher uses: the pages it
 *  already holds, and the event for each one it opens from here on. */
export interface WatchedContext {
  pages(): WatchedPage[];
  on(event: "page", handler: (page: WatchedPage) => void): unknown;
}

/** Where each kind of line lands. The arrays are the world's own, so the
 *  After hook's verdict reads what the listeners pushed. A diagnostic's
 *  console FOOTER is kept apart from a plain warning: the channel already
 *  reports the finding behind it, so the verdict would otherwise count it
 *  twice. */
export interface PageReports {
  /** Everything a document threw. */
  readonly errors: string[];
  /** Console lines that are Solid dev diagnostics or warnings. */
  readonly diagnostics: string[];
  /** Console lines that are a diagnostic's footer. */
  readonly footers: string[];
}

/**
 * Subscribe every document of this context — the scenario's page included.
 *
 * Call before `context.newPage()`, so no document can load unwatched.
 * `scenarioPage` answers the world's page once it exists; a document that is
 * not it is labelled with its URL.
 *
 * A persistent context (the app-mode recordings) opens its window at LAUNCH,
 * so its page is already there and never arrives as an event: those are
 * subscribed up front. The two sets cannot overlap — a page the context
 * already holds does not emit `page` again.
 */
export function watchContextPages(options: {
  readonly context: WatchedContext;
  readonly scenarioPage: () => unknown;
  readonly check: SolidDevCheck | undefined;
  readonly reports: PageReports;
}): void {
  const { context, scenarioPage, check, reports } = options;
  const watch = (opened: WatchedPage) => {
    const where = () => (opened === scenarioPage() ? "" : `${opened.url()}: `);
    // The stack already opens with `Name: message`, so it carries the message
    // too; a browser that reports none leaves the message as the entry.
    opened.on("pageerror", (error) =>
      reports.errors.push(where() + (error.stack ?? error.message)),
    );
    if (!check) return;
    opened.on("console", (message) => {
      const text = message.text();
      if (check.isFooter(text)) reports.footers.push(where() + text);
      else if (check.isDiagnostic(text))
        reports.diagnostics.push(where() + text);
    });
  };
  for (const open of context.pages()) watch(open);
  context.on("page", watch);
}
