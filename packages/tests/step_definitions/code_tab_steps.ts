import { Given, Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

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

/** Wait for a changed file to appear. The Code tab subscribes to a live
 *  filesystem watcher; saves and `git add` reflect within the upstream
 *  150ms debounce + the round-trip. POLL_TIMEOUT covers slow runners and
 *  the parcel-watcher initial walk on first subscribe. */
async function waitForChangedFile(world: KoluWorld, path: string) {
  await world.page
    .locator(fileRow(path))
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

// ── Actions ──

When("I click the Code tab", async function (this: KoluWorld) {
  const tab = this.page.locator('[data-testid="right-panel-tab-code"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await this.waitForFrame();
});

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
    // The mode picker is a chip + popover: open the chip, then pick
    // the option. The chip closes itself after a selection.
    const chip = this.page.locator(`[data-testid="diff-filter-chip"]`);
    await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await chip.click();
    const opt = this.page.locator(`[data-testid="diff-mode-${mode}"]`);
    await opt.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await opt.click();
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
//
// Poll the bounding box because Pierre's `VirtualizedFileDiff` is keyed
// on path; switching files makes the element pass `waitFor(visible)`
// and then return a null bounding box on the very next call as the
// virtualizer re-measures.
async function interactWithGutterLine(
  world: KoluWorld,
  root: string,
  line: number,
  button: "left" | "right",
): Promise<void> {
  const lineEl = world.page.locator(`${root} [data-column-number="${line}"]`);
  await lineEl.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const box = await pollFor({
    observe: () => lineEl.first().boundingBox(),
    isDone: (b) => !!b && b.width > 0 && b.height > 0,
    onTimeout: (last, ms) =>
      new Error(
        `line gutter ${root} [data-column-number="${line}"] has no usable bounding box after ${ms}ms (last=${JSON.stringify(last)})`,
      ),
    timeoutMs: POLL_TIMEOUT,
    intervalMs: 50,
  });
  if (!box) throw new Error("unreachable: pollFor returned without box");
  await world.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await world.page.mouse.down({ button });
  await world.page.mouse.up({ button });
  await world.waitForFrame();
}

When(
  "I click the line number {int} in the file content",
  async function (this: KoluWorld, line: number) {
    await interactWithGutterLine(this, FILE_VIEW, line, "left");
  },
);

// Right-click on a gutter line: `CodeMenuFrame`'s contextmenu handler
// reads the line from `event.composedPath()` and opens a 3-item menu
// scoped to that line. Selection + menu-open in one gesture.

When(
  "I right-click line {int} in the diff view",
  async function (this: KoluWorld, line: number) {
    await interactWithGutterLine(this, DIFF_VIEW, line, "right");
  },
);

When(
  "I right-click line {int} in the file content",
  async function (this: KoluWorld, line: number) {
    await interactWithGutterLine(this, FILE_VIEW, line, "right");
  },
);

When(
  "I click the line number {int} in the diff view",
  async function (this: KoluWorld, line: number) {
    await interactWithGutterLine(this, DIFF_VIEW, line, "left");
  },
);

// Pierre marks selected gutter + content rows with `data-selected-line`
// (see @pierre/diffs InteractionManager.renderSelectedLines). The gutter
// element also carries `data-column-number`, so we can pinpoint the line
// number via a combined attribute selector. The traversal goes through
// Pierre's open shadow tree — see `SHADOW_DFS_FN_SRC` below.
Then(
  "line {int} should be selected in the file content",
  async function (this: KoluWorld, line: number) {
    await this.page.waitForFunction(
      `(() => {
        ${SHADOW_DFS_FN_SRC}
        const root = document.querySelector('${FILE_VIEW}');
        if (!root) return false;
        return shadowDfs(root, (node) =>
          node.nodeType === 1 &&
          node.hasAttribute('data-selected-line') &&
          node.getAttribute('data-column-number') === '${line}'
        ) === true;
      })()`,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Negative variant: file is rendered but no line is highlighted. Used
// for bare-path refs (`src/Main.hs` with no `:N`) — the file should
// open, but no selection appears. Callers should first assert the file
// has loaded (e.g. `the selected file should show content "..."`) so
// this check doesn't pass trivially against a blank view.
Then(
  "no line should be selected in the file content",
  async function (this: KoluWorld) {
    const hasSelection = await this.page.evaluate(
      `(() => {
        ${SHADOW_DFS_FN_SRC}
        const root = document.querySelector('${FILE_VIEW}');
        if (!root) return false;
        return shadowDfs(root, (node) =>
          node.nodeType === 1 && node.hasAttribute('data-selected-line')
        ) === true;
      })()`,
    );
    if (hasSelection) {
      throw new Error("expected no selected line, but one was found");
    }
  },
);

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

Then("the Inspector tab should be active", async function (this: KoluWorld) {
  const btn = this.page.locator(
    '[data-testid="right-panel-tab-inspector"][data-active="true"]',
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
  "the Code tab should show the binary placeholder",
  async function (this: KoluWorld) {
    const placeholder = this.page.locator('[data-testid="diff-binary"]');
    await placeholder.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should not show the binary placeholder",
  async function (this: KoluWorld) {
    const placeholder = this.page.locator('[data-testid="diff-binary"]');
    await placeholder.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    // The chip carries `data-mode` reflecting the current view, so the
    // assertion doesn't need to open the popover (where the per-mode
    // testids live).
    const chip = this.page.locator(
      `[data-testid="diff-filter-chip"][data-mode="${mode}"]`,
    );
    await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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

Then(
  "the file browser should not show a file {string}",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

// Pierre marks selected rows with `aria-selected="true"` (and a boolean
// `data-item-selected` that may serialize as `""` or `"true"` depending
// on the renderer — `aria-selected` is the reliable string form). The
// row must also be VISIBLE — collapsed-ancestor descendants fail
// `state: "visible"` even when marked selected, so this step implicitly
// verifies ancestor expansion too.
Then(
  "the file {string} should be selected in the file browser",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(
      `${TREE} [data-item-path="${path}"][data-item-type="file"][aria-selected="true"]:not([data-file-tree-sticky-row])`,
    );
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab content should show the select hint {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (text) => {
        const content = document.querySelector('[data-testid="diff-content"]');
        return content?.textContent?.includes(text) ?? false;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Browser-side shadow-aware DFS, shared by every Pierre-DOM assertion in
// this file. Pierre mounts its rendered content inside an open shadow
// root; ordinary descendant CSS queries pierce it, but `textContent` and
// attribute walks need an explicit traversal that descends through each
// `shadowRoot.childNodes`. Defined as a string so callers can splice it
// into `page.waitForFunction` evaluators — `page.evaluate` arg functions
// crash on tsx's `__name` injection. A truthy return from `visit(node)`
// short-circuits the walk and bubbles back as the helper's return value;
// accumulator walks mutate closure state and return `undefined`.
const SHADOW_DFS_FN_SRC = `
function shadowDfs(root, visit) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    const r = visit(node);
    if (r) return r;
    if (node.nodeType === 1) {
      if (node.shadowRoot) for (const ch of node.shadowRoot.childNodes) stack.push(ch);
      for (const ch of node.childNodes) stack.push(ch);
    }
  }
}`;

async function waitForViewText(
  world: KoluWorld,
  testid: string,
  expected: string,
) {
  await world.page.waitForFunction(
    `(() => {
      ${SHADOW_DFS_FN_SRC}
      const root = document.querySelector('[data-testid="${testid}"]');
      if (!root) return false;
      let text = '';
      shadowDfs(root, (node) => {
        if (node.nodeType === 3) text += node.nodeValue || '';
      });
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
  "the file content should wrap long lines",
  async function (this: KoluWorld) {
    const row = this.page.locator(`${FILE_VIEW} [data-line]`).first();
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const line = await row.elementHandle();
    if (line === null) throw new Error("Expected a rendered file content line");

    await this.page.waitForFunction(
      (node) => {
        const line = node as Element;
        const style = getComputedStyle(line);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const singleLineHeight = Number.isFinite(lineHeight)
          ? lineHeight
          : Number.parseFloat(style.fontSize) * 1.2;
        return line.getBoundingClientRect().height > singleLineHeight * 1.5;
      },
      line,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the diff view should contain {string}",
  async function (this: KoluWorld, expected: string) {
    await waitForViewText(this, "pierre-diff-view", expected);
  },
);

// Drive Pierre's virtualized scroll viewport to its bottom. Pierre owns the
// scroll container (the `pierre-file-view` / `pierre-diff-view` host), so a
// single `scrollTop` assignment can land before the virtualizer has settled
// its row window; loop a few frames pinning scrollTop past the max so the
// last window materializes. Regression guard for the line-height-metric
// clip (#1026): the bottom rows are only reachable once Pierre's virtualizer
// knows the real row height, so this step + a last-line content assertion
// fails when the metric is wrong and passes once it matches.
When(
  "I scroll the file preview to the bottom",
  async function (this: KoluWorld) {
    await this.page.evaluate(`(async () => {
      const sels = ['[data-testid="pierre-file-view"]', '[data-testid="pierre-diff-view"]'];
      for (let i = 0; i < 12; i++) {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) el.scrollTop = el.scrollHeight + 2000;
        }
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 25)));
      }
    })()`);
    await this.waitForFrame();
  },
);

// ── Iframe preview (.html / .svg / .pdf in browse mode) ──

Then(
  "the file preview iframe should be visible",
  async function (this: KoluWorld) {
    const iframe = this.page.locator('[data-testid="browse-preview-iframe"]');
    await iframe.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// Reads the rendered DOM *inside* the sandboxed preview iframe. The frame
// runs at an opaque origin (`allow-scripts`, no `allow-same-origin`), but
// Playwright resolves it through the browser frame tree, so `frameLocator`
// reaches its `<body>` regardless of origin. Polling (not a single read)
// because a save re-points the iframe `src` at a fresh `?v=<mtime>` URL: the
// old frame detaches and the new one navigates, so `textContent` throws
// transiently mid-swap — a short per-read timeout + `.catch(() => null)`
// lets the poll ride through the navigation until the new content lands.
Then(
  "the file preview iframe should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const body = this.page
      .frameLocator('[data-testid="browse-preview-iframe"]')
      .locator("body");
    await pollFor({
      observe: () => body.textContent({ timeout: 1_000 }).catch(() => null),
      isDone: (text) => (text ?? "").includes(expected),
      onTimeout: (last) =>
        new Error(
          `iframe preview never contained "${expected}"; last body text: ${JSON.stringify(last)}`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the file preview image should be visible",
  async function (this: KoluWorld) {
    const image = this.page.locator('[data-testid="browse-preview-image"]');
    await image.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab tree pane split handle should be visible",
  async function (this: KoluWorld) {
    // The handle's own bounding box is intentionally zero-height (`h-0`);
    // a `::before` pseudo-element draws the actual hit area. Playwright's
    // `visible` check rejects zero-dimension elements, so assert
    // `attached` (in DOM) + a non-empty `data-corvu-resizable-handle`
    // attribute — proof the Corvu primitive is wired up, not just a stray
    // div carrying the testid.
    const handle = this.page.locator(
      '[data-testid="diff-tree-content-handle"][data-corvu-resizable-handle]',
    );
    await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the file preview iframe should not be visible",
  async function (this: KoluWorld) {
    // `display:none` parents (inactive tabs, collapsed panel) still leave
    // the iframe in the DOM. The text path is "not rendered at all" — assert
    // count, not visibility, so the absence is read literally.
    await this.page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="browse-preview-iframe"]')
          .length === 0,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Right-panel tab switching + filter input ──

When(
  "I click the right panel tab {string}",
  async function (this: KoluWorld, kind: string) {
    const tab = this.page.locator(`[data-testid="right-panel-tab-${kind}"]`);
    await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await tab.click();
    await this.waitForFrame();
  },
);

When(
  "I type {string} into the Code tab filter",
  async function (this: KoluWorld, value: string) {
    const input = this.page.locator('[data-testid="diff-filter-search"]');
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(value);
    await this.waitForFrame();
  },
);

Then(
  "the Code tab filter input should contain {string}",
  async function (this: KoluWorld, value: string) {
    // The filter is controlled — its value reflects the host signal exactly.
    // Polling rather than asserting once: the #817 fix re-applies search on
    // the next microtask after a row click, but the input itself is bound to
    // the host signal which doesn't move during that round-trip — still, a
    // poll keeps the assertion robust to incidental re-render timing.
    await this.page.waitForFunction(
      ({ sel, expected }) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        return el?.value === expected;
      },
      { sel: '[data-testid="diff-filter-search"]', expected: value },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Mode-parameterized helpers (Scenario Outline harness) ──
// Used by the regression-suite outlines that run identical assertions
// across {local, branch, browse}. Adding a new combinatorial regression
// is one new outline + one Examples row per mode — no per-mode scenario
// duplication. Keeps "any code-tab fix should be verified in all three
// modes" cheap to enforce, instead of relying on the author to remember.

type CodeTabMode = "local" | "branch" | "browse";

const MODE_TMP_COUNTER: { n: number } = { n: 0 };
function modeFixturePaths(mode: CodeTabMode): { work: string; origin: string } {
  // Fresh per-scenario directories so Examples rows don't collide.
  MODE_TMP_COUNTER.n += 1;
  const stamp = `${mode}-${Date.now()}-${MODE_TMP_COUNTER.n}`;
  return {
    work: `/tmp/kolu-codetab-${stamp}`,
    origin: `/tmp/kolu-codetab-${stamp}-origin.git`,
  };
}

async function runShell(world: KoluWorld, cmd: string) {
  // Reuse `KoluWorld.terminalRun` — same path as the `When I run "…"`
  // step at terminal_steps.ts:30. The polymorphic mode-setup steps
  // compose several of these in sequence so authors of new outlines
  // don't have to interleave shell setup steps explicitly.
  await world.terminalRun(cmd);
  await world.waitForFrame();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeFileCommand(path: string, content: string): string {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const mkdir = parent ? `mkdir -p ${shellQuote(parent)} && ` : "";
  return `${mkdir}printf '%s\\n' ${shellQuote(content)} > ${shellQuote(path)}`;
}

/** Per-mode shell sequence to land in a state where `<file>` is visible
 *  in the Code tab tree. Branch mode requires a real `origin` remote so
 *  Kolu's `gitStatus` stream can resolve `merge-base(origin/<default>)`
 *  for the branch-base diff — local and browse don't. */
async function setupCodeTabFixture(
  world: KoluWorld,
  mode: CodeTabMode,
  writeFiles: string,
): Promise<void> {
  const { work, origin } = modeFixturePaths(mode);
  if (mode === "local") {
    await runShell(world, `git init ${work} && cd ${work}`);
    await runShell(world, `git commit --allow-empty -m init`);
    await runShell(world, writeFiles);
  } else if (mode === "branch") {
    // `git init --bare` produces a remote we can push to; then push the
    // initial commit so `origin/<default>` resolves and `merge-base` is
    // the initial commit. Files have to be staged (`git add`) for branch
    // mode to see them — Kolu's branch-mode listing is
    // `git diff --name-status <merge-base>`, which excludes untracked
    // files (see packages/integrations/git/src/review.ts:124).
    await runShell(world, `git init --bare ${origin}`);
    await runShell(world, `git init ${work} && cd ${work}`);
    await runShell(world, `git remote add origin ${origin}`);
    await runShell(world, `git commit --allow-empty -m init`);
    await runShell(world, `git push -u origin HEAD`);
    await runShell(world, `git checkout -b feature`);
    await runShell(world, writeFiles);
    await runShell(world, `git add .`);
  } else if (mode === "browse") {
    await runShell(world, `git init ${work} && cd ${work}`);
    await runShell(world, writeFiles);
    await runShell(world, `git add . && git commit -m init`);
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
}

async function activateCodeTabMode(
  world: KoluWorld,
  mode: CodeTabMode,
): Promise<void> {
  const tab = world.page.locator('[data-testid="right-panel-tab-code"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await world.waitForFrame();
  if (mode === "local") return; // default
  const chip = world.page.locator(`[data-testid="diff-filter-chip"]`);
  await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await chip.click();
  const opt = world.page.locator(`[data-testid="diff-mode-${mode}"]`);
  await opt.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await opt.click();
  await world.waitForFrame();
}

/** Wait for the Pierre file tree to finish its first hydration — at least
 *  one real (non-sticky) row visible. Without this gate the subsequent
 *  per-path assertion has to absorb both "tree mounted" and "specific row
 *  rendered" against a single timeout; under darwin CI load the combined
 *  chain (fs.watcher → server → SSE → SolidJS → Pierre mount) repeatedly
 *  exceeded 20 s and was the single most-recurring flake site (#955). */
async function waitForCodeTabReady(world: KoluWorld): Promise<void> {
  await world.page
    .locator(
      `${TREE} [data-item-path][data-item-type]:not([data-file-tree-sticky-row])`,
    )
    .first()
    .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
}

async function waitForFixturePath(
  world: KoluWorld,
  mode: CodeTabMode,
  path: string,
): Promise<void> {
  // Two-step wait — first the tree's hydration, then the specific path.
  // Each step carries its own timeout against its own volatility axis;
  // the fused single-locator wait (the prior shape) made both axes share
  // POLL_TIMEOUT and starved the slow hydration side on loaded runners.
  await waitForCodeTabReady(world);
  if (mode === "browse") return;
  await world.page
    .locator(fileRow(path))
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

/** Set up the Code tab in `<mode>` showing one file. The shell sequence
 *  is mode-specific (see `setupCodeTabFixture`); post-conditions are
 *  uniform: file row visible, mode chip set. */
Given(
  "a Code tab in {string} mode showing file {string} with content {string}",
  async function (
    this: KoluWorld,
    mode: string,
    path: string,
    content: string,
  ) {
    const m = mode as CodeTabMode;
    await setupCodeTabFixture(this, m, writeFileCommand(path, content));
    await activateCodeTabMode(this, m);
    await waitForFixturePath(this, m, path);
  },
);

/** Multi-file variant. DataTable rows: `| path | content |`. */
Given(
  "a Code tab in {string} mode showing files:",
  async function (
    this: KoluWorld,
    mode: string,
    table: { rawTable: string[][] },
  ) {
    const m = mode as CodeTabMode;
    const rows = table.rawTable.slice(1); // skip header
    const writes = rows.map(([p, c]) => writeFileCommand(p, c)).join(" && ");
    await setupCodeTabFixture(this, m, writes);
    await activateCodeTabMode(this, m);
    const firstPath = rows[0]?.[0];
    if (firstPath) {
      await waitForFixturePath(this, m, firstPath);
    }
  },
);

/** Mode-agnostic file click. The DOM selector
 *  `[data-item-path][data-item-type="file"]` is identical across modes
 *  (Pierre stamps both attributes regardless of which stream populated
 *  the tree), so a single click step covers local/branch/browse. */
When(
  "I open file {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    const item = this.page.locator(fileRow(path));
    await item.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.click();
    await this.waitForFrame();
  },
);

/** Mode-agnostic file-listing assertion. Same selector across modes. */
Then(
  "the Code tab should show file {string}",
  async function (this: KoluWorld, path: string) {
    await this.page
      .locator(fileRow(path))
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab should not show file {string}",
  async function (this: KoluWorld, path: string) {
    await this.page
      .locator(fileRow(path))
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

/** Mode-agnostic content assertion. Diff modes render
 *  `[data-testid="pierre-diff-view"]`; browse mode renders
 *  `[data-testid="pierre-file-view"]`. Either is fine — the assertion
 *  succeeds if the expected text appears in whichever view is mounted. */
Then(
  "the selected file should show content {string}",
  async function (this: KoluWorld, expected: string) {
    // Split: (1) wait for one of the view roots to mount under HYDRATION
    // budget, (2) wait for the expected text under POLL budget. The fused
    // pre-#955 shape carried both axes against POLL_TIMEOUT — text never
    // got a fair chance once a slow runner spent most of the budget on
    // the view mount.
    await this.page
      .locator(`${DIFF_VIEW}, ${FILE_VIEW}`)
      .first()
      .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    await this.page.waitForFunction(
      `(() => {
        ${SHADOW_DFS_FN_SRC}
        for (const sel of ['${DIFF_VIEW}', '${FILE_VIEW}']) {
          const root = document.querySelector(sel);
          if (!root) continue;
          let text = '';
          shadowDfs(root, (node) => {
            if (node.nodeType === 3) text += node.nodeValue || '';
          });
          if (text.includes(${JSON.stringify(expected)})) return true;
        }
        return false;
      })()`,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── Comments tray + composer + pill (#881) ──
//
// Pure-logic coverage lives in `packages/artifact-sdk/src/core/findQuote.test.ts`,
// `packages/artifact-sdk/src/server/inject.test.ts`, and
// `packages/client/src/comments/formatMarkdown.test.ts`. The scenarios
// below exercise the user-visible flow end-to-end: real text selection
// inside Pierre's shadow DOM (via `shadowDfs` + `Selection.addRange`),
// the floating pill, the composer popover, and the persisted tray.

const COMMENTS_TRAY = '[data-testid="kolu-comments-tray"]';
const COMMENT_PILL = '[data-testid="kolu-comment-pill"]';
const COMMENT_COMPOSER = '[data-testid="kolu-comment-composer"]';

Then(
  "the comments tray should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(COMMENTS_TRAY)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then("the comments tray should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(COMMENTS_TRAY)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the comments tray should contain {string}",
  async function (this: KoluWorld, text: string) {
    await this.page
      .locator(COMMENTS_TRAY)
      .getByText(text, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the comments tray should not contain {string}",
  async function (this: KoluWorld, text: string) {
    // Poll until the text is absent from the tray. The tray may still
    // be visible (other comments queued) but this specific text must
    // be gone — string-template body (see selection step's rationale).
    await this.page.waitForFunction(
      `(() => {
        const tray = document.querySelector('${COMMENTS_TRAY}');
        if (!tray) return true;
        return !(tray.textContent || "").includes(${JSON.stringify(text)});
      })()`,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the comments tray should have {int} comments",
  async function (this: KoluWorld, count: number) {
    await this.page.waitForFunction(
      `(() => {
        const tray = document.querySelector('${COMMENTS_TRAY}');
        if (!tray) return ${count} === 0;
        const items = tray.querySelectorAll('[data-testid="kolu-tray-item"]');
        return items.length === ${count};
      })()`,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Drive a REAL mouse drag to select text — same code path a user hits,
// not a synthetic `Selection.addRange`. The earlier synthetic step
// pretended to work but bypassed `window.getSelection()` shadow-DOM
// invisibility (per spec, document.getSelection cannot see selections
// whose anchor/focus is inside a shadow tree — `ShadowRoot.getSelection()`
// is the Chrome-specific escape hatch). A test that doesn't fire real
// pointer events doesn't test what the user actually does.
//
// Algorithm:
//   1. Poll Pierre's shadow tree (via `shadowDfs`) until a text node
//      containing the target appears.
//   2. Locate the target's bounding-rect ENDPOINTS by creating a Range
//      in the page and asking `getClientRects()` — this is read-only
//      shadow-DOM peeking, not a user-facing selection set.
//   3. Drive `page.mouse.move/down/move/up` across those rect
//      coordinates so the browser fires the same pointer + selection
//      events it does for a real drag.
When(
  "I select text {string} in the file content",
  async function (this: KoluWorld, target: string) {
    // (1) Wait for the target to be present in the rendered shadow DOM.
    await this.page.waitForFunction(
      `(() => {
        ${SHADOW_DFS_FN_SRC}
        const view = document.querySelector('[data-testid="pierre-file-view"]');
        if (!view) return false;
        const target = ${JSON.stringify(target)};
        let found = false;
        shadowDfs(view, (n) => {
          if (n.nodeType === 3 && (n.nodeValue || "").indexOf(target) !== -1) {
            found = true;
            return true;
          }
        });
        return found;
      })()`,
      undefined,
      { timeout: POLL_TIMEOUT },
    );

    // (2) Get the bounding rect of the target's range in viewport coords.
    //     The Range itself is throwaway — used only to compute pixel
    //     coordinates for the mouse drag.
    const rect = (await this.page.evaluate(
      `(() => {
        ${SHADOW_DFS_FN_SRC}
        const view = document.querySelector('[data-testid="pierre-file-view"]');
        if (!view) return null;
        const target = ${JSON.stringify(target)};
        let foundNode = null;
        let foundOffset = -1;
        shadowDfs(view, (n) => {
          if (n.nodeType === 3) {
            const txt = n.nodeValue || "";
            const idx = txt.indexOf(target);
            if (idx !== -1) { foundNode = n; foundOffset = idx; return true; }
          }
        });
        if (!foundNode || foundOffset < 0) return null;
        const range = document.createRange();
        range.setStart(foundNode, foundOffset);
        range.setEnd(foundNode, foundOffset + target.length);
        const rects = range.getClientRects();
        const first = rects[0];
        const last = rects[rects.length - 1];
        if (!first || !last) return null;
        return {
          startX: first.left,
          startY: first.top + first.height / 2,
          endX: last.right,
          endY: last.top + last.height / 2,
        };
      })()`,
    )) as { startX: number; startY: number; endX: number; endY: number } | null;
    if (!rect) {
      throw new Error(`Could not locate "${target}" in Pierre's rendered DOM`);
    }

    // (3) Drag from the start of the target to the end. Three move steps
    //     keep the browser's selection model awake for short ranges;
    //     a single `move + down + up` sometimes collapses on Chromium.
    await this.page.mouse.move(rect.startX, rect.startY);
    await this.page.mouse.down();
    await this.page.mouse.move(
      (rect.startX + rect.endX) / 2,
      (rect.startY + rect.endY) / 2,
      { steps: 3 },
    );
    await this.page.mouse.move(rect.endX, rect.endY, { steps: 3 });
    await this.page.mouse.up();
    await this.waitForFrame();
  },
);

Then("the comment pill should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(COMMENT_PILL)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the comment pill should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(COMMENT_PILL)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When("I click the comment pill", async function (this: KoluWorld) {
  const pill = this.page.locator(COMMENT_PILL);
  await pill.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  // The pill uses mousedown (not click) to keep the selection alive
  // before the browser collapses it on focus. Drive the same event.
  await pill.dispatchEvent("mousedown");
  await this.waitForFrame();
});

Then(
  "the comment composer should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(COMMENT_COMPOSER)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the comment composer should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(COMMENT_COMPOSER)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I type {string} into the comment composer",
  async function (this: KoluWorld, body: string) {
    const ta = this.page.locator(`${COMMENT_COMPOSER} textarea`);
    await ta.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ta.fill(body);
    await this.waitForFrame();
  },
);

When(
  "I click the composer {string} button",
  async function (this: KoluWorld, label: string) {
    const btn = this.page.locator(COMMENT_COMPOSER).getByRole("button", {
      name: label,
    });
    await btn.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.first().click();
    await this.waitForFrame();
  },
);

When("I press Escape in the composer", async function (this: KoluWorld) {
  const composer = this.page.locator(COMMENT_COMPOSER);
  await composer.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  // Escape is handled on the composer div's onKeyDown — focus must be
  // inside the composer for the handler to fire.
  await this.page.locator(`${COMMENT_COMPOSER} textarea`).press("Escape");
  await this.waitForFrame();
});

When(
  "I click the comments tray {string} button",
  async function (this: KoluWorld, label: string) {
    const btn = this.page.locator(COMMENTS_TRAY).getByRole("button", {
      name: label,
    });
    await btn.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.first().click();
    await this.waitForFrame();
  },
);

When(
  "I remove the tray comment containing {string}",
  async function (this: KoluWorld, body: string) {
    // Each tray item is `<li>` with a comment-body button and a
    // per-item × remove button (aria-label "Remove comment on <path>").
    // Match the item that contains the body text, then click its ×.
    await this.page
      .locator(COMMENTS_TRAY)
      .locator(`li:has-text("${body}")`)
      .first()
      .getByRole("button", { name: /Remove comment/ })
      .click();
    await this.waitForFrame();
  },
);

When("I reload the page", async function (this: KoluWorld) {
  await this.page.reload();
  // App boot + Code-tab mount + repoPath() resolution; the tests rely
  // on the right panel staying open across reloads via persisted state.
  await this.waitForFrame();
});
