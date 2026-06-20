import { Given, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { nudgeDir, nudgeFiles } from "../support/nudge.ts";
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
const DIFF_CONTENT = '[data-testid="diff-content"]';

function fileRow(path: string): string {
  return `${TREE} [data-item-path="${path}"][data-item-type="file"]:not([data-file-tree-sticky-row])`;
}

function dirRow(path: string): string {
  return `${TREE} [data-item-path="${path}/"][data-item-type="folder"]:not([data-file-tree-sticky-row])`;
}

/** First-appearance wait for a Pierre tree row / Code-tab chrome element.
 *
 *  Populating the tree (browse mode: a full server-side repo walk; diff
 *  modes: a `git status` / `git diff` round-trip) then rendering it through
 *  fs.watch → SSE → SolidJS → Pierre's virtualized mount is a HYDRATION
 *  axis, distinct from the fast interaction that follows. The mode-helper
 *  path already encodes this (`waitForCodeTabReady` waits under
 *  HYDRATION_TIMEOUT), but the *inline* browse scenarios — `git init` +
 *  `I click the Code tab` + `I click the Code tab mode "browse"` + a direct
 *  row click — bypass that helper and charged the first row's appearance to
 *  POLL_TIMEOUT. Under darwin CI load — especially the cold-cache moment
 *  right after the per-commit koluBin rebuild — that population repeatedly
 *  exceeds 20 s, which was the single largest residual flake (the whole
 *  browse-mode file-tree scenario family). Give the *first* appearance the
 *  hydration budget; once the tree mounts every row is present, so one wait
 *  suffices and the in-tree interactions after it stay on POLL_TIMEOUT. */
async function waitTreeReady(
  world: KoluWorld,
  selector: string,
): Promise<void> {
  await world.page
    .locator(selector)
    .first()
    .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
}

/** Wait for a changed file to appear. The Code tab subscribes to a live
 *  filesystem watcher; saves and `git add` reflect within the upstream
 *  150ms debounce + the round-trip. Hydration budget — first population of
 *  the tree under darwin load is the slow axis (see `waitTreeReady`). */
async function waitForChangedFile(world: KoluWorld, path: string) {
  await waitTreeReady(world, fileRow(path));
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
    await waitTreeReady(this, fileRow(path));
    await this.page.locator(fileRow(path)).click();
    await this.waitForFrame();
  },
);

When(
  "I click the Code tab mode {string}",
  async function (this: KoluWorld, mode: string) {
    // The scope switcher is a segmented control: every view is a visible
    // segment, so switching is a single click — no popover to open. The
    // segments are Code-tab chrome that only paint once the repo view has
    // hydrated, so the first appearance gets the hydration budget (see
    // waitTreeReady).
    const seg = this.page.locator(`[data-testid="diff-mode-${mode}"]`);
    await waitTreeReady(this, `[data-testid="diff-mode-${mode}"]`);
    await seg.click();
    await this.waitForFrame();
  },
);

When(
  "I right-click the changed file {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, fileRow(path));
    await this.page.locator(fileRow(path)).click({ button: "right" });
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

// Focus the Code tab content pane by *clicking* it — the real user gesture
// the feature depends on. The pane is `tabindex=-1` (click-focusable but not
// in the Tab order), so a click moves `document.activeElement` OUT of the
// terminal and into the Code tab — the condition under which Cmd/Ctrl+F defers
// to the browser's native find-in-page instead of opening kolu's terminal
// search. We click (not programmatic `.focus()`) so a regression in click-
// focusability — the whole point of the `tabindex=-1` — actually fails this
// step, then assert focus left the terminal (no `data-kolu-terminal-search`
// ancestor) and landed in the content pane before the caller presses the chord.
When("I focus the Code tab content", async function (this: KoluWorld) {
  const content = this.page.locator(DIFF_CONTENT);
  await content.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await content.click();
  await pollFor({
    observe: () =>
      content.evaluate(
        (el) =>
          document.activeElement != null &&
          el.contains(document.activeElement) &&
          document.activeElement.closest("[data-kolu-terminal-search]") == null,
      ),
    isDone: (outside) => outside,
    onTimeout: () =>
      new Error(
        "focus did not leave the terminal and land in the Code tab content",
      ),
    timeoutMs: POLL_TIMEOUT,
  });
  await this.waitForFrame();
});

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
    await waitTreeReady(this, dirRow(path));
  },
);

Then(
  "the Code tab should not show a directory node {string}",
  async function (this: KoluWorld, path: string) {
    const dir = this.page.locator(dirRow(path));
    await dir.waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the directory node {string} in the Code tab",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, dirRow(path));
    await this.page.locator(dirRow(path)).click();
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
    // `processLine` (see @pierre/diffs/utils/processLine). First diff render
    // follows a `git diff` round-trip + virtualized mount — hydration budget.
    await waitTreeReady(this, `${DIFF_VIEW} [data-line]`);
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
    // The segmented control carries `data-mode` reflecting the active
    // view, so the assertion is a single read with no interaction.
    const segments = this.page.locator(
      `[data-testid="diff-mode-toggle"][data-mode="${mode}"]`,
    );
    await segments.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab {string} segment should show a change count of {string}",
  async function (this: KoluWorld, mode: string, count: string) {
    // The segmented control paints as soon as the repo resolves; the
    // count badge follows once the always-on gitStatus stream for that
    // mode lands (working-tree watcher → server → SSE). Give the badge
    // the hydration budget — under darwin CI load the status round-trip
    // shares the slow first-population axis the tree does.
    const badge = this.page.locator(`[data-testid="diff-mode-${mode}-count"]`);
    await pollFor({
      observe: async () =>
        (await badge.count()) === 0
          ? null
          : ((await badge.first().textContent())?.trim() ?? null),
      isDone: (v) => v === count,
      onTimeout: (last, ms) =>
        new Error(
          `Code tab "${mode}" count badge: expected "${count}", last saw "${last}" after ${ms}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

Then(
  "the Code tab {string} segment should show no change count",
  async function (this: KoluWorld, mode: string) {
    await this.page
      .locator(`[data-testid="diff-mode-${mode}-count"]`)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

// ── File browser actions ──

When(
  "I click the file {string} in the file browser",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, fileRow(path));
    await this.page.locator(fileRow(path)).click();
    await this.waitForFrame();
  },
);

When(
  "I click the directory {string} in the file browser",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, dirRow(path));
    await this.page.locator(dirRow(path)).click();
    await this.waitForFrame();
  },
);

// ── File browser assertions ──

Then(
  "the file browser should show a directory {string}",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, dirRow(path));
  },
);

Then(
  "the directory {string} should be expanded in the file browser",
  async function (this: KoluWorld, path: string) {
    // A revealed folder is open (`aria-expanded="true"`, folders only) AND
    // visible — its ancestors are expanded and the row scrolled into view, so
    // `state: "visible"` also verifies the reveal walked the ancestry. First
    // appearance gets the hydration budget, like the other tree-row waits.
    await waitTreeReady(
      this,
      `${TREE} [data-item-path="${path}/"][data-item-type="folder"][aria-expanded="true"]:not([data-file-tree-sticky-row])`,
    );
  },
);

Then(
  "the file browser should show a file {string}",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, fileRow(path));
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
    // Selection lands after the click's mode/diff round-trip resolves; under
    // darwin load that first settle is on the hydration axis (waitTreeReady).
    await waitTreeReady(
      this,
      `${TREE} [data-item-path="${path}"][data-item-type="file"][aria-selected="true"]:not([data-file-tree-sticky-row])`,
    );
  },
);

// Negative of the above: assert a file row is NOT the selected one. Used by
// the GitHub-exact relative-link regression (#1161) — a link to a missing
// `docs/guide.md` must not silently open a same-basename `src/guide.md` via
// the terminal resolver's fuzzy basename fallback. Settles a beat first so a
// late-arriving (wrong) selection still trips the assertion rather than racing
// past it.
Then(
  "the file {string} should not be selected in the file browser",
  async function (this: KoluWorld, path: string) {
    await this.waitForFrame();
    await new Promise((r) => setTimeout(r, 750));
    const count = await this.page
      .locator(
        `${TREE} [data-item-path="${path}"][data-item-type="file"][aria-selected="true"]:not([data-file-tree-sticky-row])`,
      )
      .count();
    if (count !== 0) {
      throw new Error(
        `Expected "${path}" not to be selected, but it was — the relative-link ` +
          `resolver fell back to a same-basename file (#1161 regression)`,
      );
    }
  },
);

// A revealed folder is expanded + scrolled, but never *selected* — the
// folder-ref front door reveals a directory without making a content pick
// (the `kind: "directory"` branch in CodeTab calls `setRevealDir`, not
// `select`). Settles a beat first so a late-arriving (wrong) selection still
// trips the assertion rather than racing past it — same shape as the
// file-not-selected step above.
Then(
  "the directory {string} should not be selected in the file browser",
  async function (this: KoluWorld, path: string) {
    await this.waitForFrame();
    await new Promise((r) => setTimeout(r, 750));
    const count = await this.page
      .locator(
        `${TREE} [data-item-path="${path}/"][data-item-type="folder"][aria-selected="true"]:not([data-file-tree-sticky-row])`,
      )
      .count();
    if (count !== 0) {
      throw new Error(
        `Expected directory "${path}" not to be selected, but it was — a ` +
          `folder reveal must expand + scroll without making a content pick`,
      );
    }
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
    // Hydration budget: the preview content arrives over a server
    // subscription (selection → fsReadFile, or an *edit* re-firing the live
    // watch which re-points the iframe `src` at a fresh `?v=<mtime>`). That
    // fs.watch → SSE → reload round-trip is the slow axis under darwin CI
    // load — the edit-then-refresh regression guard (code-tab.feature:1364)
    // froze on the pre-edit body for >20 s under the post-build storm.
    await pollFor({
      observe: () => body.textContent({ timeout: 1_000 }).catch(() => null),
      isDone: (text) => text?.includes(expected) ?? false,
      onTimeout: (last) =>
        new Error(
          `iframe preview never contained "${expected}"; last body text: ${JSON.stringify(last)}`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

// Edit-then-refresh variant: after a file is rewritten in the shell, the live
// preview reloads only when the file-change watch (`subscribeFileChange` →
// `watchWorkingTree(repoRoot, { filePath })`) fires. On darwin that single
// FSEvents notification is sometimes dropped under the post-koluBin-build
// storm, so the iframe freezes on the pre-edit body and the bare assertion
// above (even at HYDRATION_TIMEOUT) waits forever — no further event ever
// comes. Re-touch the edited file's mtime each poll tick: each touch is a
// fresh notification, so a dropped one is recovered, and a new mtime re-points
// the iframe `src` (`?v=<mtime>`) to force the reload. The file already holds
// the post-edit content, so this recovers the lost event without changing what
// is asserted — it does NOT mask a broken watch re-arm (a touch of a file the
// watch isn't armed on still fires nothing). `absFile` is the absolute on-disk
// path the shell wrote (the scenario's repo cwd + relative path).
Then(
  "the file preview iframe should refresh to {string} after editing {string}",
  async function (this: KoluWorld, expected: string, absFile: string) {
    const body = this.page
      .frameLocator('[data-testid="browse-preview-iframe"]')
      .locator("body");
    await pollFor({
      observe: () => body.textContent({ timeout: 1_000 }).catch(() => null),
      isDone: (text) => text?.includes(expected) ?? false,
      onTick: () => nudgeFiles([absFile]),
      onTimeout: (last) =>
        new Error(
          `iframe preview never refreshed to "${expected}" after editing ${absFile}; ` +
            `last body text: ${JSON.stringify(last)}`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

// Click an `<a>` link *inside* the sandboxed preview iframe. Same origin
// boundary as the read step above — Playwright's `frameLocator` resolves the
// frame through the browser frame tree regardless of the opaque-origin
// sandbox, so the click drives a real same-frame navigation, exactly the
// gesture a user makes following a hyperlink between two HTML files.
When(
  "I click the link {string} in the file preview iframe",
  async function (this: KoluWorld, linkText: string) {
    const link = this.page
      .frameLocator('[data-testid="browse-preview-iframe"]')
      .getByRole("link", { name: linkText });
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await link.click();
    await this.waitForFrame();
  },
);

// Click an EXTERNAL `<a>` inside the sandboxed preview. The frame is
// `allow-scripts` only (no `allow-popups`/`allow-top-navigation`), so a real
// browser would either swallow the click or replace the preview in-pane — the
// in-iframe artifact-sdk traps it and asks the parent to `window.open` the URL
// in a fresh tab, which surfaces as a new page on the context. The route stub
// fulfils the external host so the popup commits without network egress; the
// captured page is stashed for the assertion step.
When(
  "I click the external link {string} in the file preview iframe",
  async function (this: KoluWorld, linkText: string) {
    await this.context.route("https://example.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><h1>external target reached</h1>",
      }),
    );
    const link = this.page
      .frameLocator('[data-testid="browse-preview-iframe"]')
      .getByRole("link", { name: linkText });
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const popup = this.context.waitForEvent("page", { timeout: POLL_TIMEOUT });
    await link.click();
    this.externalPopup = await popup;
  },
);

Then(
  "a new browser tab should open to {string}",
  async function (this: KoluWorld, expected: string) {
    const popup = this.externalPopup;
    if (!popup) throw new Error("no external popup was captured");
    // Compare normalized hrefs exactly, not a substring: `includes` would pass
    // for a wrong destination that merely contains the expected string (e.g.
    // `…/docs-bad`, or `…?next=https://example.com/docs`). `new URL().href`
    // normalizes both sides so a trailing-slash difference isn't a false miss.
    const want = new URL(expected).href;
    await pollFor({
      observe: () => Promise.resolve(popup.url()),
      isDone: (url) => {
        try {
          return new URL(url).href === want;
        } catch {
          // popup URL may be "about:blank" or otherwise unparseable before
          // navigation commits — not done yet.
          return false;
        }
      },
      onTimeout: (last) =>
        new Error(`popup opened to "${last}", expected "${expected}"`),
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
  "the file preview video should be visible",
  async function (this: KoluWorld) {
    const video = this.page.locator('[data-testid="browse-preview-video"]');
    await video.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // The container alone could be an empty box; assert a real <video controls>
    // element mounted inside it so the test proves the renderer dispatched to
    // the video appliance, not a stray div.
    await this.page
      .locator('[data-testid="browse-preview-video"] video[controls]')
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
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

/** Drag the tree/content split handle upward, growing the preview
 *  (content) pane. The handle element is zero-height (`h-0`) with a
 *  `::before` pseudo drawing the real hit area, so Playwright's
 *  `boundingBox()`/`dragTo()` (which require visibility) can't drive it —
 *  read the rect directly and run a raw mouse drag through the hit zone. */
When(
  "I drag the Code tab tree\\/content split handle up by {int} pixels",
  async function (this: KoluWorld, pixels: number) {
    const handle = this.page.locator(
      '[data-testid="diff-tree-content-handle"][data-corvu-resizable-handle]',
    );
    await handle.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
    const rect = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    });
    const x = rect.x + rect.width / 2;
    await this.page.mouse.move(x, rect.y);
    await this.page.mouse.down();
    await this.page.mouse.move(x, rect.y - pixels, { steps: 5 });
    await this.page.mouse.up();
    await this.waitForFrame();
  },
);

When(
  "I note the Code tab preview pane height",
  async function (this: KoluWorld) {
    const box = await this.page.locator(DIFF_CONTENT).boundingBox();
    if (!box) throw new Error("diff-content pane has no bounding box");
    this.savedCodeTabPreviewHeight = box.height;
  },
);

/** Sanity gate for the drag step above: proves the drag actually moved
 *  the split (within a small tolerance for Corvu's min-size clamping and
 *  fractional rounding) before the scenario goes on to test persistence. */
Then(
  "the Code tab preview pane should be about {int} pixels taller than noted",
  async function (this: KoluWorld, pixels: number) {
    const noted = this.savedCodeTabPreviewHeight;
    if (noted === undefined) {
      throw new Error("No noted preview pane height in this scenario");
    }
    await pollFor({
      observe: async () =>
        (await this.page.locator(DIFF_CONTENT).boundingBox())?.height,
      isDone: (h) => h !== undefined && Math.abs(h - (noted + pixels)) <= 10,
      onTimeout: (last, elapsed) =>
        new Error(
          `preview pane height ${last}px never reached ~${noted + pixels}px ` +
            `(noted ${noted}px + ${pixels}px drag) within ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the Code tab preview pane height should match the noted height",
  async function (this: KoluWorld) {
    const noted = this.savedCodeTabPreviewHeight;
    if (noted === undefined) {
      throw new Error("No noted preview pane height in this scenario");
    }
    // Poll: after a terminal switch the Code tab remounts behind
    // `<Show when={repoPath()}>` and Corvu re-lays-out async — give the
    // split a moment to converge before judging it.
    await pollFor({
      observe: async () =>
        (await this.page.locator(DIFF_CONTENT).boundingBox())?.height,
      isDone: (h) => h !== undefined && Math.abs(h - noted) <= 2,
      onTimeout: (last, elapsed) =>
        new Error(
          `preview pane height settled at ${last}px, expected the noted ` +
            `${noted}px (±2px) within ${elapsed}ms — the tree/content split ` +
            `did not survive the terminal switch`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
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

// ── Markdown preview + Source ⇄ Rendered toggle (.md in browse mode) ──

Then(
  "the markdown preview should be visible",
  async function (this: KoluWorld) {
    const md = this.page.locator('[data-testid="browse-preview-markdown"]');
    await md.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// The rendered preview is plain DOM (not a sandboxed iframe), so its text
// reads directly. Poll because the content arrives over the `fsReadFile`
// subscription a frame or two after the click.
Then(
  "the markdown preview should contain {string}",
  async function (this: KoluWorld, expected: string) {
    const md = this.page.locator('[data-testid="browse-preview-markdown"]');
    // Hydration budget: the rendered content arrives over the fsReadFile
    // subscription after selection — the slow propagation axis under darwin
    // CI load, like the iframe preview above.
    await pollFor({
      observe: () => md.textContent({ timeout: 1_000 }).catch(() => null),
      isDone: (text) => text?.includes(expected) ?? false,
      onTimeout: (last) =>
        new Error(
          `markdown preview never contained "${expected}"; last text: ${JSON.stringify(last)}`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

// A >1 MB Markdown file is read back truncated; the preview must surface the
// same "File truncated" banner the source view shows, otherwise a partial
// document renders with no warning. The banner is a sibling ABOVE the
// commentable preview (not inside it — see `truncationBanner` in
// BrowseFileDispatcher: keeping it out of the comment surface stops it being
// selected as an un-findable comment quote), so this targets its testid.
Then(
  "the markdown preview should show the truncation warning",
  async function (this: KoluWorld) {
    const banner = this.page.locator(
      '[data-testid="browse-truncation-banner"]',
    );
    await banner.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the file view toggle should be visible",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="fileview-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I switch the file view to {string}",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(`[data-testid="fileview-toggle-${mode}"]`);
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await btn.click();
    await this.waitForFrame();
  },
);

Then(
  "the markdown preview should not be visible",
  async function (this: KoluWorld) {
    // Toggling to source unmounts the rendered appliance (FileView swaps the
    // active branch), so assert count, mirroring the iframe absence check.
    await this.page.waitForFunction(
      () =>
        document.querySelectorAll('[data-testid="browse-preview-markdown"]')
          .length === 0,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Structural assertions for the rebuilt marked → DOMPurify pipeline
// (@kolu/solid-markdown). The rendered preview must emit real GFM / inline-HTML
// elements — tables, task checkboxes, <kbd>, alignment wrappers — and must NOT
// emit script-capable markup. `selector` is a semantic element/attribute query
// scoped under the preview testid (e.g. "table", "input[type=checkbox]"),
// never a styling class.
Then(
  "the markdown preview should render a {string} element",
  async function (this: KoluWorld, selector: string) {
    await this.page.waitForFunction(
      (sel) =>
        !!document.querySelector(
          `[data-testid="browse-preview-markdown"] ${sel}`,
        ),
      selector,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Negative form, for sanitization. Scenarios assert a positive text match
// first so the preview has demonstrably rendered before we check that a
// dangerous element is absent (rather than merely not yet painted).
Then(
  "the markdown preview should not render a {string} element",
  async function (this: KoluWorld, selector: string) {
    await this.page.waitForFunction(
      (sel) =>
        document.querySelectorAll(
          `[data-testid="browse-preview-markdown"] ${sel}`,
        ).length === 0,
      selector,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// Click a repo-relative anchor in the rendered preview and assert it opens the
// file IN the app, not a new browser tab. The #1161 bug stamped `target=_blank`
// on relative links, so a click spawned a popup at the app origin; the fix tags
// them for in-app interception. Arm a popup watch *before* the click and fail if
// it ever fires — a green run proves no tab was opened.
When(
  "I click the repo-relative markdown link {string}",
  async function (this: KoluWorld, href: string) {
    const link = this.page.locator(
      `[data-testid="browse-preview-markdown"] a[href="${href}"]`,
    );
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const popped = this.page
      .waitForEvent("popup", { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    await link.click();
    if (await popped) {
      throw new Error(
        `Clicking the repo-relative link "${href}" opened a new browser tab ` +
          `(the #1161 bug); it should open the file in the Code tab instead`,
      );
    }
    await this.waitForFrame();
  },
);

// Click an Obsidian-style `[[wikilink]]` in the rendered preview. The bare
// target (`Architecture` / `Note`) is carried on the `data-md-wikilink`
// attribute (the href is an inert `#`), so styling + click-routing differ from a
// regular link. Like a relative link it must never open a browser tab — arm a
// popup watch and fail if one fires.
When(
  "I click the wikilink {string}",
  async function (this: KoluWorld, target: string) {
    const link = this.page.locator(
      `[data-testid="browse-preview-markdown"] a[data-md-wikilink="${target}"]`,
    );
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const popped = this.page
      .waitForEvent("popup", { timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    await link.click();
    if (await popped) {
      throw new Error(
        `Clicking the wikilink "${target}" opened a new browser tab; it must ` +
          `resolve in the Code tab instead`,
      );
    }
    await this.waitForFrame();
  },
);

// The disambiguation menu shown when a wikilink's basename matches more than
// one repo file — an anchored list of candidate paths portalled to the body.
Then(
  "the wikilink disambiguation menu should be visible",
  async function (this: KoluWorld) {
    const menu = this.page.locator(
      '[data-testid="wikilink-disambiguation-menu"]',
    );
    await menu.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

// Pick one candidate path from the open disambiguation menu. The option's
// testid carries the path verbatim (`…-option-<path>`).
When(
  "I click the wikilink candidate {string}",
  async function (this: KoluWorld, path: string) {
    const opt = this.page.locator(
      `[data-testid="wikilink-disambiguation-option-${path}"]`,
    );
    await opt.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await opt.click();
    await this.waitForFrame();
  },
);

// Tailwind v4's preflight resets `list-style: none` app-wide, so the rendered
// preview must re-declare list markers or every list renders unmarked. Assert
// the computed marker is actually disc/decimal, not the reset `none` — a plain
// "renders a ul" check would pass even with the bug.
Then(
  "the markdown preview list markers should be visible",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => {
        const root = '[data-testid="browse-preview-markdown"]';
        const ul = document.querySelector(`${root} ul:not(:has(input))`);
        const ol = document.querySelector(`${root} ol`);
        if (!ul || !ol) return false;
        return (
          getComputedStyle(ul).listStyleType === "disc" &&
          getComputedStyle(ol).listStyleType === "decimal"
        );
      },
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the markdown preview should not contain {string}",
  async function (this: KoluWorld, unexpected: string) {
    const md = this.page.locator('[data-testid="browse-preview-markdown"]');
    // The preview is already visible at this point (asserted earlier in the
    // scenario), so a single read is enough to confirm the text is absent.
    const text = (await md.textContent({ timeout: POLL_TIMEOUT })) ?? "";
    if (text.includes(unexpected)) {
      throw new Error(
        `markdown preview unexpectedly contained "${unexpected}"`,
      );
    }
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
): Promise<string> {
  const { work, origin } = modeFixturePaths(mode);
  if (mode === "local") {
    await runShell(world, `git init ${work} && cd ${work}`);
    await runShell(world, `git commit --allow-empty -m init`);
    await runShell(world, writeFiles);
  } else if (mode === "branch") {
    // Branch mode's listing is `git diff --name-status merge-base(HEAD,
    // origin/<default>)`, which excludes untracked files — so files must be
    // staged (`git add`) and `origin/<default>` must resolve. The server
    // detects `<default>` via `git symbolic-ref refs/remotes/origin/HEAD`
    // (then falls back to origin/main, origin/master). If none resolves it
    // returns BASE_BRANCH_NOT_FOUND, which on the FIRST read of the passive
    // branchStatus subscription throws and tears the stream down for good (only
    // *later* reads are swallowed) — so a work-tree nudge can never revive it
    // and the tree stays empty. The previous order (`git init work && cd work`
    // -> remote add -> push) flipped repoRoot at the `cd`, opening that
    // subscription whose first read could race the push and observe "origin
    // exists but origin/master does not yet" — the residual branch-mode flake
    // that lost both cucumber attempts on the slower darwin runner.
    //
    // Fix: establish the base ref ATOMICALLY with the `origin` remote so no read
    // can ever observe that in-between state. Populate the bare origin from a
    // throwaway seed repo INSIDE A SUBSHELL — so the terminal's cwd never enters
    // the seed; a passive read there (origin configured at `remote add` but its
    // push not yet landed) would hit the very same BASE_BRANCH_NOT_FOUND, just
    // moved to the seed. Then `git clone` it into `work`: clone creates
    // `origin`, `origin/master` and `origin/HEAD` in one operation, so the
    // instant the terminal cd's into `work` (the only repo it ever enters) every
    // gitStatus read resolves a valid base. The marker is split across a shell
    // string-concat (`SET""TLED`) so the search text matches only the command's
    // OUTPUT, never the typed echo.
    const seed = `${origin}-seed`;
    await runShell(world, `git init --bare -b master ${origin}`);
    await runShell(
      world,
      `(git init -b master ${seed} && cd ${seed} && ` +
        `git remote add origin ${origin} && ` +
        `git commit --allow-empty -m init && git push -u origin master)`,
    );
    await runShell(world, `git clone ${origin} ${work} && cd ${work}`);
    await runShell(world, `git checkout -b feature`);
    await runShell(world, writeFiles);
    await runShell(world, `git add .`);
    const token = work.replace(/[^a-zA-Z0-9]/g, "");
    // Only emit the barrier marker once origin/master is verifiably resolvable;
    // a missing base emits a distinct marker so the wait fails loudly instead
    // of racing on into a permanently-empty branch tree.
    await runShell(
      world,
      `git rev-parse --verify origin/master >/dev/null 2>&1 ` +
        `&& echo "KOLU_SET""TLED_${token}" || echo "KOLU_BASE""MISSING_${token}"`,
    );
    await waitForBufferContains(world.page, `KOLU_SETTLED_${token}`);
  } else if (mode === "browse") {
    await runShell(world, `git init ${work} && cd ${work}`);
    await runShell(world, writeFiles);
    await runShell(world, `git add . && git commit -m init`);
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  return work;
}

async function activateCodeTabMode(
  world: KoluWorld,
  mode: CodeTabMode,
): Promise<void> {
  const tab = world.page.locator('[data-testid="right-panel-tab-code"]');
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await tab.click();
  await world.waitForFrame();
  // The Code tab now defaults to "browse" (DEFAULT_RIGHT_PANEL_PER_TERMINAL),
  // so every mode — including local — must be selected explicitly; there is
  // no implicit default to short-circuit on.
  // The scope segments are Code-tab chrome that only paint once the repo view
  // has hydrated — hydration budget so a loaded runner doesn't lose the switch
  // before the tree-readiness gate downstream even runs (see waitTreeReady).
  const seg = world.page.locator(`[data-testid="diff-mode-${mode}"]`);
  await waitTreeReady(world, `[data-testid="diff-mode-${mode}"]`);
  await seg.click();
  await world.waitForFrame();
}

/** Wait for the Pierre file tree to finish its first hydration — at least
 *  one real (non-sticky) row visible. Without this gate the subsequent
 *  per-path assertion has to absorb both "tree mounted" and "specific row
 *  rendered" against a single timeout; under darwin CI load the combined
 *  chain (fs.watcher → server → SSE → SolidJS → Pierre mount) repeatedly
 *  exceeded 20 s and was the single most-recurring flake site (#955).
 *
 *  `nudgeWork` (branch mode) re-fires the repo's working-tree watcher each
 *  tick. The gitStatus stream re-reads `getStatus`→`resolveBase` on every
 *  `subscribeRepoChange` event, so if the FIRST resolve raced the push and
 *  errored `BASE_BRANCH_NOT_FOUND` (origin/<default> not yet visible — the
 *  residual branch-mode flake that loses both cucumber attempts), a sentinel
 *  create+unlink in the work tree fires a repo change that re-resolves
 *  against the now-settled repo and the tree populates. The sentinel is
 *  untracked (excluded from the branch diff) and removed immediately, so it
 *  never appears in the tree. */
async function waitForCodeTabReady(
  world: KoluWorld,
  nudgeWork?: string,
): Promise<void> {
  const row = world.page
    .locator(
      `${TREE} [data-item-path][data-item-type]:not([data-file-tree-sticky-row])`,
    )
    .first();
  if (!nudgeWork) {
    await row.waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    return;
  }
  await pollFor({
    observe: () => row.isVisible().catch(() => false),
    isDone: (visible) => visible === true,
    onTick: () => nudgeDir(nudgeWork),
    onTimeout: (_last, elapsed) =>
      new Error(
        `Code tab tree never hydrated a row within ${elapsed}ms (work=${nudgeWork}) — ` +
          `branch-mode gitStatus likely stuck on BASE_BRANCH_NOT_FOUND`,
      ),
    timeoutMs: HYDRATION_TIMEOUT,
    intervalMs: 500,
  });
}

async function waitForFixturePath(
  world: KoluWorld,
  mode: CodeTabMode,
  path: string,
  work?: string,
): Promise<void> {
  // Two-step wait — first the tree's hydration, then the specific path.
  // Each step carries its own timeout against its own volatility axis;
  // the fused single-locator wait (the prior shape) made both axes share
  // POLL_TIMEOUT and starved the slow hydration side on loaded runners.
  // Branch mode passes `work` so the hydration wait can nudge a stuck
  // gitStatus subscription back to life (see waitForCodeTabReady).
  await waitForCodeTabReady(world, mode === "branch" ? work : undefined);
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
    const work = await setupCodeTabFixture(
      this,
      m,
      writeFileCommand(path, content),
    );
    await activateCodeTabMode(this, m);
    await waitForFixturePath(this, m, path, work);
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
    const work = await setupCodeTabFixture(this, m, writes);
    await activateCodeTabMode(this, m);
    const firstPath = rows[0]?.[0];
    if (firstPath) {
      await waitForFixturePath(this, m, firstPath, work);
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
    await waitTreeReady(this, fileRow(path));
    await this.page.locator(fileRow(path)).click();
    await this.waitForFrame();
  },
);

/** Mode-agnostic file-listing assertion. Same selector across modes. */
Then(
  "the Code tab should show file {string}",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, fileRow(path));
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

/** Git-status decoration assertion. Pierre stamps `data-item-git-status`
 *  (word form: `modified` / `added` / `untracked` / `renamed` / `deleted`)
 *  on a decorated row — see `@pierre/trees` `render/rowAttributes`. The
 *  selector pierces Pierre's shadow root like the other row selectors. */
Then(
  "the Code tab file {string} should have git status {string}",
  async function (this: KoluWorld, path: string, status: string) {
    // The decorated row appears as the gitStatus stream lands — first
    // settle is on the hydration axis under darwin load (waitTreeReady).
    await waitTreeReady(
      this,
      `${fileRow(path)}[data-item-git-status="${status}"]`,
    );
  },
);

Then(
  "the Code tab file {string} should have no git status",
  async function (this: KoluWorld, path: string) {
    // Browse lists every file, so a clean file's row is present but
    // undecorated. A point-in-time check is sound here: the gitStatus stream
    // delivers one atomic snapshot, and callers assert the *positive*
    // decorations (`… should have git status …`) before this step — so by the
    // time we read a clean row, that same snapshot has already settled every
    // row. Read through the Playwright locator (which pierces Pierre's open
    // shadow root); a raw `document.querySelector` inside `waitForFunction`
    // would not cross the shadow boundary — see SHADOW_DFS_FN_SRC below.
    await waitTreeReady(this, fileRow(path));
    const row = this.page.locator(fileRow(path));
    const value = await row.getAttribute("data-item-git-status");
    if (value !== null) {
      throw new Error(
        `Expected "${path}" to carry no git status, got "${value}"`,
      );
    }
  },
);

// ── Folder roll-up: ancestor directories of a change ──
// Pierre marks every ancestor of a changed file with
// `data-item-contains-git-change="true"`. kolu injects a shadow-root rule
// (FileTree.shadowCss) that tints those folders' names; these steps assert the
// roll-up attribute and that the tint actually lands (computed color differs
// from a clean sibling).

Then(
  "the Code tab directory {string} should be marked as containing a change",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(
      this,
      `${dirRow(path)}[data-item-contains-git-change="true"]`,
    );
  },
);

Then(
  "the Code tab directory {string} should not be marked as containing a change",
  async function (this: KoluWorld, path: string) {
    await waitTreeReady(this, dirRow(path));
    const row = this.page.locator(dirRow(path));
    const value = await row.getAttribute("data-item-contains-git-change");
    if (value !== null) {
      throw new Error(
        `Expected directory "${path}" to carry no contained-change mark, got "${value}"`,
      );
    }
  },
);

/** Proves the injected shadow-root tint actually lands: the changed folder's
 *  name (`[data-item-section='content']`) must compute a different color than a
 *  clean sibling folder's name. Reading the computed color (not a fixed value)
 *  keeps the assertion robust to palette changes. */
Then(
  "the Code tab directory {string} name should be tinted differently from directory {string}",
  async function (this: KoluWorld, changed: string, clean: string) {
    const nameColor = async (path: string): Promise<string> => {
      const name = this.page
        .locator(`${dirRow(path)} [data-item-section="content"]`)
        .first();
      await name.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
      return name.evaluate((el) => getComputedStyle(el).color);
    };
    // Wait for the roll-up to land on the changed folder before sampling, so
    // the tint has been applied by the time we read its color. First settle
    // of the gitStatus decoration is on the hydration axis (waitTreeReady).
    await waitTreeReady(
      this,
      `${dirRow(changed)}[data-item-contains-git-change="true"]`,
    );
    const changedColor = await nameColor(changed);
    const cleanColor = await nameColor(clean);
    if (changedColor === cleanColor) {
      throw new Error(
        `Expected "${changed}" name (${changedColor}) to be tinted differently from clean "${clean}" (${cleanColor})`,
      );
    }
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

// Drive a REAL mouse drag to select `target` inside the container matched by
// `containerSelector`. Walks shadow trees (Pierre's `CodeView` nests one); the
// Markdown preview is plain light DOM and the same DFS handles it unchanged.
async function dragSelectText(
  world: KoluWorld,
  containerSelector: string,
  target: string,
): Promise<void> {
  // (1) Wait for the target to be present in the rendered DOM.
  await world.page.waitForFunction(
    `(() => {
      ${SHADOW_DFS_FN_SRC}
      const view = document.querySelector(${JSON.stringify(containerSelector)});
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
  const rect = (await world.page.evaluate(
    `(() => {
      ${SHADOW_DFS_FN_SRC}
      const view = document.querySelector(${JSON.stringify(containerSelector)});
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
    throw new Error(
      `Could not locate "${target}" in ${containerSelector}'s rendered DOM`,
    );
  }

  // (3) Drag from the start of the target to the end. Three move steps
  //     keep the browser's selection model awake for short ranges;
  //     a single `move + down + up` sometimes collapses on Chromium.
  await world.page.mouse.move(rect.startX, rect.startY);
  await world.page.mouse.down();
  await world.page.mouse.move(
    (rect.startX + rect.endX) / 2,
    (rect.startY + rect.endY) / 2,
    { steps: 3 },
  );
  await world.page.mouse.move(rect.endX, rect.endY, { steps: 3 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

When(
  "I select text {string} in the file content",
  async function (this: KoluWorld, target: string) {
    await dragSelectText(this, '[data-testid="pierre-file-view"]', target);
  },
);

When(
  "I select text {string} in the markdown preview",
  async function (this: KoluWorld, target: string) {
    await dragSelectText(
      this,
      '[data-testid="browse-preview-markdown"]',
      target,
    );
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

// The in-place comment highlight rides the CSS Custom Highlight API: the
// overlay registers ranges under the "kolu-comment" highlight name. A non-zero
// range count proves the overlay re-anchored against the live DOM — the
// regression this guards is the rendered Markdown preview swapping its subtree
// after mount (lazy Shiki re-render), which detaches any earlier ranges; the
// overlay's MutationObserver must re-apply so the highlight doesn't silently
// vanish. Polled because Shiki warms a frame or two after the preview mounts.
Then(
  "the comment highlight should be present",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page
          .evaluate("window.CSS?.highlights?.get('kolu-comment')?.size ?? 0")
          .catch(() => 0),
      isDone: (size) => typeof size === "number" && size > 0,
      onTimeout: (last) =>
        new Error(
          `comment highlight never registered any ranges; last size: ${JSON.stringify(last)}`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
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

// Click a tray item's body button to jump to its anchor. The body button
// carries the comment text; clicking it fires `onJumpTo`, which navigates the
// browse view (and, for a multi-surface file, flips the Source ⇄ Rendered
// toggle back to the surface the comment was made on).
When(
  "I click the tray comment {string}",
  async function (this: KoluWorld, body: string) {
    const item = this.page
      .locator(COMMENTS_TRAY)
      .locator('[data-testid="kolu-tray-item"]', { hasText: body });
    await item.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await item.first().click();
    await this.waitForFrame();
  },
);

// Assert which Source ⇄ Rendered surface is active by reading the toggle's
// `aria-pressed`. Used to verify a tray jump flipped back to the right surface.
Then(
  "the file view should be showing {string}",
  async function (this: KoluWorld, mode: string) {
    const btn = this.page.locator(`[data-testid="fileview-toggle-${mode}"]`);
    await pollFor({
      observe: () => btn.getAttribute("aria-pressed").catch(() => null),
      isDone: (pressed) => pressed === "true",
      onTimeout: (last) =>
        new Error(
          `file view never showed "${mode}"; toggle aria-pressed was ${JSON.stringify(last)}`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
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

// ── Back / forward navigation (phase 2: the Code tab is a browser) ──
// Selecting files records history in @kolu/solid-browser's createBrowser; the
// toolbar ◀ ▶ buttons (the primary affordance — Alt+←/→ is the scoped-keybind
// alternate) retrace it. These drive the buttons by their testids.

When("I go back in the Code tab", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="code-tab-back-button"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await this.waitForFrame();
});

When("I go forward in the Code tab", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="code-tab-forward-button"]');
  await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await btn.click();
  await this.waitForFrame();
});

Then(
  "the Code tab {string} button should be disabled",
  async function (this: KoluWorld, dir: string) {
    const id =
      dir === "back" ? "code-tab-back-button" : "code-tab-forward-button";
    // A disabled <button> keeps the `disabled` attribute, so `:disabled`
    // attaches exactly when createBrowser reports an end of the stack
    // (canBack/canForward false) and the button is greyed out.
    const btn = this.page.locator(`[data-testid="${id}"]:disabled`);
    await btn.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Code tab {string} button should be enabled",
  async function (this: KoluWorld, dir: string) {
    const id =
      dir === "back" ? "code-tab-back-button" : "code-tab-forward-button";
    // The inverse of the disabled check — `:enabled` attaches exactly when
    // createBrowser reports a live entry to traverse to (canBack/canForward
    // true), proving the reactive enablement tracks the stack in both
    // directions.
    const btn = this.page.locator(`[data-testid="${id}"]:enabled`);
    await btn.waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);
