import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

// ── Pierre tree selectors ──
//
// `@pierre/trees` renders rows inside a `<file-tree-container>` custom element
// whose shadow root is open. Playwright's CSS engine pierces open shadow DOM,
// so a single descendant selector reaches every visible row. Rows expose
// `data-item-path`, `data-item-type` (`file` / `folder`), and `aria-expanded`
// (folders only).
//
// Quirk: directory rows carry a TRAILING SLASH on `data-item-path`
// (e.g. `src/`), files don't (`src/index.ts`). `dirRow` adds it for the
// caller so feature files can stay friendly (`"src"`, not `"src/"`).
//
// `data-testid="pierre-file-tree"` is on our wrapper div; the same wrapper is
// used in browse, local, and branch modes (the file browser is no longer a
// separate widget after #708). Pierre also renders sticky-folder duplicates
// for headers — `:not([data-file-tree-sticky-row])` keeps assertions on the
// real (clickable) row, not the static header.

const TREE = '[data-testid="pierre-file-tree"]';
const DIFF_VIEW = '[data-testid="pierre-diff-view"]';
const FILE_VIEW = '[data-testid="pierre-file-view"]';

function fileRow(path: string): string {
  return `${TREE} [data-item-path="${path}"][data-item-type="file"]:not([data-file-tree-sticky-row])`;
}

function dirRow(path: string): string {
  return `${TREE} [data-item-path="${path}/"][data-item-type="folder"]:not([data-file-tree-sticky-row])`;
}

/** Wait for a changed file to appear, refreshing periodically. The Code tab
 *  hits git via RPC; on a freshly-created repo the watcher hasn't fired yet
 *  and the first list comes back empty. The refresh button forces a re-fetch. */
async function waitForChangedFile(world: KoluWorld, path: string) {
  const item = world.page.locator(fileRow(path));
  const refresh = world.page.locator('[data-testid="diff-refresh"]');
  const deadline = Date.now() + POLL_TIMEOUT;
  let nextRefresh = Date.now();

  while (Date.now() < deadline) {
    // Best-effort polling — `isVisible` can throw if the page navigates
    // between locator resolutions, and the refresh button can race with
    // re-renders; a thrown probe just falls through to the next tick.
    if (await item.isVisible().catch(() => false)) return;

    if (Date.now() >= nextRefresh && (await refresh.isVisible())) {
      await refresh.click().catch(() => undefined);
      nextRefresh = Date.now() + 1000;
    }

    await world.page.waitForTimeout(100);
  }

  await item.waitFor({ state: "visible", timeout: 1 });
}

// ── Actions ──

When("I click the Code tab", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-code"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await this.waitForFrame();
});

When(
  "I click the refresh button in the Code tab",
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="diff-refresh"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

When(
  "I click the changed file {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

When(
  "I click the Code tab mode {string}",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(`[data-testid="diff-mode-${mode}"]`);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

When(
  "I right-click the changed file {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click({ button: "right" });
    await this.waitForFrame();
  },
);

/** Click a top-level item in the tree/file/diff context menu. The diff and
 *  file viewers render `<button role="menuitem">` (`CodeContextMenu`); the
 *  tree's Pierre-slot menu uses plain `<button>`. Match either via a CSS
 *  fallback so callers don't have to know which one fired. */
When(
  "I click the context menu item {string}",
  async function (this: KoluWorld, label: string) {
    const escaped = label.replace(/"/g, '\\"');
    const btn = this.page.locator(
      `button:has-text("${escaped}"), [role="menuitem"]:has-text("${escaped}")`,
    );
    await btn.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.first().click();
    await this.waitForFrame();
  },
);

// `enableLineSelection` only fires for clicks on gutter line numbers,
// not on the line content. Target the `[data-column-number]` element
// (Pierre's `getSelectionPointerInfo` requires `numberColumn=true`).
//
// Pierre's `enableLineSelection` commits on `document` pointerup, not
// element-level click — drive the gutter via Playwright's mouse API so
// pointerdown / pointerup bubble through the document listener Pierre
// attached on pointerdown. Both the file viewer (`FILE_VIEW`) and the
// diff viewer (`DIFF_VIEW`) wrap the same Pierre primitive, so the
// gutter selector and mouse dance are identical — only the host
// element's CSS root changes.
async function clickLineGutterIn(world: KoluWorld, root: string, line: number) {
  const lineEl = world.page.locator(`${root} [data-column-number="${line}"]`);
  await lineEl.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const box = await lineEl.first().boundingBox();
  if (!box) throw new Error("line gutter has no bounding box");
  await world.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await world.page.mouse.down();
  await world.page.mouse.up();
  await world.waitForFrame();
}

async function rightClickViewRoot(world: KoluWorld, root: string) {
  const view = world.page.locator(root);
  await view.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await view.click({ button: "right" });
  await world.waitForFrame();
}

When(
  "I click the line number {int} in the file content",
  async function (this: KoluWorld, line: number) {
    await clickLineGutterIn(this, FILE_VIEW, line);
  },
);

When("I right-click the file content", async function (this: KoluWorld) {
  await rightClickViewRoot(this, FILE_VIEW);
});

When(
  "I click the line number {int} in the diff view",
  async function (this: KoluWorld, line: number) {
    await clickLineGutterIn(this, DIFF_VIEW, line);
  },
);

When("I right-click the diff view", async function (this: KoluWorld) {
  await rightClickViewRoot(this, DIFF_VIEW);
});

// Asserts the exact set of items in the Pierre diff/file context menu,
// in order, joined with " | ". Stronger than `I click the context menu
// item {string}` because it catches "wrong items present" regressions
// (e.g. a stale path:line entry persisting across file switches) that a
// targeted click would only surface as an opaque locator timeout.
Then(
  "the context menu items should be {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => {
        const menu = document.querySelector("#code-context-menu");
        if (!menu) return false;
        const got = Array.from(menu.querySelectorAll('[role="menuitem"]'))
          .map((b) => b.textContent || "")
          .join(" | ");
        return got === exp;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Assertions ──

Then("the Code tab should be active", async function (this: KoluWorld) {
  // The Code tab button exposes data-active reflecting the active
  // tab, which is independent of in-repo vs no-repo content.
  const btn = this.page.locator(
    '[data-testid="right-panel-tab-code"][data-active="true"]',
  );
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the Code tab should indicate no git repository",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="diff-no-repo"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should show the empty-changes message",
  async function (this: KoluWorld) {
    const msg = this.page.locator('[data-testid="diff-empty"]');
    await msg.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should list a changed file {string}",
  async function (this: KoluWorld, path: string) {
    await waitForChangedFile(this, path);
  },
);

Then(
  "the Code tab should show a directory node {string}",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(dirRow(path));
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the directory node {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(dirRow(path));
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await dir.click();
    await this.waitForFrame();
  },
);

Then(
  "the Code tab should not list a changed file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should render a diff view",
  async function (this: KoluWorld) {
    // Pierre's `FileDiff` mounts the wrapper even with zero hunks; assert on
    // an actual rendered diff line. `[data-line]` is set per-row by Pierre's
    // `processLine` (see @pierre/diffs/utils/processLine).
    const row = this.page.locator(`${DIFF_VIEW} [data-line]`).first();
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(
      `[data-testid="diff-mode-${mode}"][data-active="true"]`,
    );
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// ── File browser actions ──

When(
  "I click the file {string} in the file browser",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

When(
  "I click the directory {string} in the file browser",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(dirRow(path));
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await dir.click();
    await this.waitForFrame();
  },
);

// ── File browser assertions ──

Then(
  "the file browser should show a directory {string}",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(dirRow(path));
    await dir.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the file browser should show a file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// Pierre's File / FileDiff renderers mount highlighted code inside a
// shadow root. `Element.textContent` does NOT cross shadow boundaries,
// so we walk the tree (including each `shadowRoot`) and stitch the text.
// Inlined as a string-evaluate to dodge tsx's `__name` injection, which
// crashes inside `page.evaluate` arg functions.
async function waitForViewText(
  world: KoluWorld,
  testid: string,
  expected: string,
) {
  await world.page.waitForFunction(
    `(() => {
      const root = document.querySelector('[data-testid="${testid}"]');
      if (!root) return false;
      const stack = [root];
      let text = '';
      while (stack.length) {
        const node = stack.pop();
        if (node.nodeType === 3) text += node.nodeValue || '';
        if (node.nodeType === 1) {
          if (node.shadowRoot) for (const ch of node.shadowRoot.childNodes) stack.push(ch);
          for (const ch of node.childNodes) stack.push(ch);
        }
      }
      return text.includes(${JSON.stringify(expected)});
    })()`,
    undefined,
    { timeout: POLL_TIMEOUT },
  );
}

Then(
  "the file content should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForViewText(this, "pierre-file-view", expected);
  },
);

Then(
  "the diff view should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForViewText(this, "pierre-diff-view", expected);
  },
);
