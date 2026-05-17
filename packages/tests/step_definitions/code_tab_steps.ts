import { Given, Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
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

// ── Iframe preview (.html / .svg / .pdf in browse mode) ──

Then(
  "the file preview iframe should be visible",
  async function (this: KoluWorld) {
    const iframe = this.page.locator('[data-testid="browse-preview-iframe"]');
    await iframe.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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

async function waitForFixturePath(
  world: KoluWorld,
  mode: CodeTabMode,
  path: string,
): Promise<void> {
  const selector =
    mode === "browse"
      ? `${TREE} [data-item-path][data-item-type]:not([data-file-tree-sticky-row])`
      : fileRow(path);
  await world.page
    .locator(selector)
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
