Feature: Code tab (review + browse)
  The Code tab is one Pierre file tree with three modes:
    - All (browse)   — full repo, file content on selection
    - Local          — working tree vs HEAD, diff on selection
    - Branch         — working tree vs merge-base(origin/<default>), diff on selection
  The tree, diff viewer, and file viewer are all owned by `@pierre/trees`
  and `@pierre/diffs` (PR #708). This feature exercises the data flow,
  selection, mode transitions, and the right-click affordances the Pierre
  wrappers expose to copy paths and line refs.

  Background:
    Given the terminal is ready
    When I press the toggle inspector shortcut
    Then the right panel should be visible

  # ── Tab presence + chrome ──

  Scenario: Code tab is present and switchable
    When I click the Code tab
    Then the Code tab should be active

  Scenario: Shows "not a git repo" message outside a repo
    When I run "cd /tmp"
    And I click the Code tab
    Then the Code tab should indicate no git repository

  Scenario: Git init after no-repo state refreshes Code tab and pill tree
    When I run "rm -rf /tmp/kolu-code-init-refresh && mkdir -p /tmp/kolu-code-init-refresh && cd /tmp/kolu-code-init-refresh"
    And I click the Code tab
    Then the Code tab should indicate no git repository
    When a git repo is initialized externally in "/tmp/kolu-code-init-refresh" on branch "code-refresh"
    Then the Code tab should show the empty-changes message
    And the pill tree label should show "kolu-code-init-refresh"
    And the pill tree branch should contain "code-refresh"

  Scenario: Shows "no changes" when the repo is clean
    When I run "git init /tmp/kolu-review-clean && cd /tmp/kolu-review-clean"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    Then the Code tab should show the empty-changes message

  # ── Mode picker ──

  Scenario: Mode toggle defaults to Local
    When I run "git init /tmp/kolu-review-toggle && cd /tmp/kolu-review-toggle"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    Then the Code tab mode should be "local"

  Scenario: Code tab mode survives panel close and reopen
    When I run "git init /tmp/kolu-review-mode-persist && cd /tmp/kolu-review-mode-persist"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the Code tab mode should be "browse"

  # ── Regression suites for #817/#818 ──
  # Each invariant runs in all three Code-tab modes (local, branch,
  # browse) via `Scenario Outline` + an `Examples` row per mode. The
  # mode-parameterized harness lives in `code_tab_steps.ts` (search for
  # "Mode-parameterized helpers"):
  #
  #   Given a Code tab in "<mode>" mode showing file "..." with content "..."
  #   When  I open file "..." in the Code tab
  #   Then  the selected file should show content "..."
  #   Then  the Code tab should [not] show file "..."
  #
  # The shell setup, mode-chip click, and view-vs-diff dispatch are all
  # hidden behind these polymorphic steps. Adding a fourth Code-tab
  # regression test means writing one Outline plus three Examples rows;
  # the per-mode coverage is automatic. Don't fall back to hand-written
  # `[local]` / `[branch]` / `[browse]` scenarios — that's how the
  # `view()` `"local"` fallback bug shipped past the first round of
  # tests.

  # Regression for #818: collapsing and reopening the right panel used
  # to unmount RightPanel via `<Show when={!collapsed()}>`, discarding
  # CodeTab's selectedPath signal. Resizable already shrinks the panel
  # to zero width on collapse — keeping it mounted preserves selection.
  Scenario Outline: Selected file survives panel collapse and reopen [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # Regression for #818: switching to Inspector and back used to unmount
  # CodeTab via `match(activeTab())`, discarding selectedPath. Both tabs
  # are now always rendered with `display:none` toggling visibility.
  Scenario Outline: Selected file survives Inspector tab switch [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I click the right panel tab "inspector"
    And I click the right panel tab "code"
    Then the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  # ── Local mode: file list + diff rendering ──

  Scenario: Lists changed files and opens a diff on click
    When I run "git init /tmp/kolu-review-dirty && cd /tmp/kolu-review-dirty"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\n' > note.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Code tab
    Then the Code tab should render a diff view

  # Regression for #817: Pierre's row-click handler unconditionally calls
  # `controller.closeSearch()` after firing selection (verified at
  # @pierre/trees/dist/render/FileTreeView.js around the row-click plan,
  # where `closeSearch: isSearchOpen` is hardcoded). The solid-pierre
  # wrapper re-applies the host's `searchQuery` on the next microtask so
  # the host-controlled filter survives clicks. Re-click step covers
  # Pierre's selectionVersion gate that suppresses `onSelectionChange`
  # but still runs `closeSearch()`.
  Scenario Outline: Filter survives clicking a filtered result [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path      | content |
      | alpha.txt | a       |
      | beta.txt  | b       |
      | gamma.txt | g       |
    Then the Code tab should show file "alpha.txt"
    And the Code tab should show file "beta.txt"
    When I type "alp" into the Code tab filter
    Then the Code tab should show file "alpha.txt"
    And the Code tab should not show file "beta.txt"
    And the Code tab should not show file "gamma.txt"
    When I open file "alpha.txt" in the Code tab
    Then the selected file should show content "a"
    And the Code tab filter input should contain "alp"
    And the Code tab should show file "alpha.txt"
    And the Code tab should not show file "beta.txt"
    And the Code tab should not show file "gamma.txt"
    When I open file "alpha.txt" in the Code tab
    Then the Code tab filter input should contain "alp"
    And the Code tab should show file "alpha.txt"
    And the Code tab should not show file "beta.txt"
    And the Code tab should not show file "gamma.txt"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario Outline: Filter matches files by path tokens [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path                          | content |
      | common/src/index.tsx          | common  |
      | common/src/components/App.tsx | app     |
      | packages/client/src/index.tsx | client  |
    When I type "common index.ts" into the Code tab filter
    Then the Code tab should show file "common/src/index.tsx"
    And the Code tab should not show file "common/src/components/App.tsx"
    And the Code tab should not show file "packages/client/src/index.tsx"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario: Untracked files appear alongside modified tracked files
    When I run "git init /tmp/kolu-review-untracked && cd /tmp/kolu-review-untracked"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'initial\n' > tracked.txt && git add tracked.txt && git commit -m 'add tracked'"
    And I run "printf 'modified\n' > tracked.txt"
    And I run "printf 'new\n' > untracked.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "tracked.txt"
    And the Code tab should list a changed file "untracked.txt"

  # ── Pierre tree behaviour: directory grouping + collapse ──

  Scenario: Groups files into a directory tree
    When I run "git init /tmp/kolu-review-tree && cd /tmp/kolu-review-tree"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/components && printf 'a\n' > src/index.ts && printf 'b\n' > src/components/Button.tsx"
    And I click the Code tab
    Then the Code tab should show a directory node "src"
    And the Code tab should list a changed file "src/index.ts"
    And the Code tab should list a changed file "src/components/Button.tsx"

  Scenario: Collapsing a directory hides its children
    When I run "git init /tmp/kolu-review-collapse && cd /tmp/kolu-review-collapse"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p pkg && printf 'x\n' > pkg/a.ts && printf 'y\n' > pkg/b.ts"
    And I click the Code tab
    Then the Code tab should list a changed file "pkg/a.ts"
    When I click the directory node "pkg" in the Code tab
    Then the Code tab should not list a changed file "pkg/a.ts"
    When I click the directory node "pkg" in the Code tab
    Then the Code tab should list a changed file "pkg/a.ts"

  # ── Pierre tree right-click menu (Copy path) ──

  Scenario: Right-click on a changed file copies its path
    When I run "git init /tmp/kolu-tree-ctx && cd /tmp/kolu-tree-ctx"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p api && printf 'q\n' > api/handler.ts"
    And I click the Code tab
    Then the Code tab should list a changed file "api/handler.ts"
    When I right-click the changed file "api/handler.ts" in the Code tab
    And I click the context menu item "Copy path"
    Then the clipboard should contain "api/handler.ts"

  # ── Browse mode: file tree + content viewer ──

  Scenario: File browser shows the repo file tree
    When I run "git init /tmp/kolu-browse-tree && cd /tmp/kolu-browse-tree"
    And I run "mkdir -p src && printf 'a\n' > README.md && printf 'b\n' > src/index.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    And the file browser should show a directory "src"
    And the file browser should show a file "README.md"

  Scenario: File browser shows file content on click
    When I run "git init /tmp/kolu-browse-content && cd /tmp/kolu-browse-content"
    And I run "printf 'hello world\n' > greeting.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "greeting.txt" in the file browser
    Then the file content should contain "hello world"

  Scenario: File browser expands directories lazily
    When I run "git init /tmp/kolu-browse-expand && cd /tmp/kolu-browse-expand"
    And I run "mkdir -p lib && printf 'x\n' > lib/util.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the file browser should show a directory "lib"
    When I click the directory "lib" in the file browser
    Then the file browser should show a file "lib/util.ts"

  # ── Pierre file/diff viewer right-click menu (Copy path:line) ──

  Scenario: Right-click on file content with a selected line copies "path:line"
    When I run "git init /tmp/kolu-browse-ctx && cd /tmp/kolu-browse-ctx"
    And I run "printf 'alpha\nbeta\ngamma\n' > letters.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "letters.txt" in the file browser
    Then the file content should contain "beta"
    When I click the line number 2 in the file content
    And I right-click the file content
    And I click the context menu item "Copy letters.txt:2"
    Then the clipboard should contain "letters.txt:2"

  # Regression: switching diff files used to break the "Copy path:line"
  # context-menu entry. Two interleaved causes — first, a `<Match>` callback
  # in CodeTab captured `selectedPath()` to a `const`, freezing the path
  # prop fed into `<PierreDiffView>`. Second, even after the path was made
  # reactive, Pierre's `FileDiff.render(newFileDiff)` reuses the same
  # instance and its line-selection handlers don't re-bind to the fresh
  # gutter elements — so right-clicks on the second file's lines yielded a
  # menu with no "Copy path:line" entry at all (range stayed null because
  # no `onLineSelected` ever fired). Fix: key the diff/browse subtree on
  # path so each file gets a fresh `FileDiff` and a clean
  # `useLineSelection` range.
  Scenario: Switching diff files keeps the "Copy path:line" entry in sync
    When I run "git init /tmp/kolu-diff-multifile && cd /tmp/kolu-diff-multifile"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'a-one\na-two\na-three\n' > file-a.txt"
    And I run "printf 'b-one\nb-two\nb-three\n' > file-b.txt"
    And I click the Code tab
    Then the Code tab should list a changed file "file-a.txt"
    And the Code tab should list a changed file "file-b.txt"
    When I click the changed file "file-a.txt" in the Code tab
    Then the diff view should contain "a-one"
    When I click the line number 1 in the diff view
    And I right-click the diff view
    And I click the context menu item "Copy file-a.txt:1"
    Then the clipboard should contain "file-a.txt:1"
    When I click the changed file "file-b.txt" in the Code tab
    Then the diff view should contain "b-one"
    When I click the line number 1 in the diff view
    And I right-click the diff view
    Then the context menu items should be "Copy path | Copy file-b.txt:1"
    When I click the context menu item "Copy file-b.txt:1"
    Then the clipboard should contain "file-b.txt:1"
    And the clipboard should not contain "file-a.txt"

  # ── Live updates: filesystem changes propagate without manual refresh ──
  # The Code view subscribes to a watcher that observes four axes (HEAD,
  # reflog, index, working tree) and pushes snapshot updates whenever any
  # changes. These two scenarios open the tab on a selected file, mutate
  # the file from the shell, and assert the new content reaches the diff
  # body and the browse body — no click on a refresh button (it's gone).
  #
  # The post-tab `I click the terminal canvas` is required: clicking the
  # right-panel tab moves focus off the terminal, so subsequent keystrokes
  # would land in the panel instead of the PTY.

  Scenario: Editing a file updates the diff view live
    When I run "git init /tmp/kolu-live-diff && cd /tmp/kolu-live-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'before\n' > note.txt"
    And I click the Code tab
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "before"
    When I click the terminal canvas
    And I run "printf 'after\n' > note.txt"
    Then the diff view should contain "after"

  Scenario: Editing a file updates browse-mode content live
    When I run "git init /tmp/kolu-live-browse && cd /tmp/kolu-live-browse"
    And I run "printf 'first version\n' > letters.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "letters.txt" in the file browser
    Then the file content should contain "first version"
    When I click the terminal canvas
    And I run "printf 'second version\n' > letters.txt"
    Then the file content should contain "second version"

  Scenario: Committing the selected local diff clears the stale content pane
    When I run "rm -rf /tmp/kolu-clear-selected-local && git init /tmp/kolu-clear-selected-local && cd /tmp/kolu-clear-selected-local"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'before\n' > note.txt"
    And I click the Code tab
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "before"
    When I click the terminal canvas
    And I run "git add note.txt && git commit -m 'save note'"
    Then the Code tab should show the empty-changes message
    And the Code tab content should show the select hint "Select a file to view its diff"

  Scenario: Deleting the selected browse file clears the stale content pane
    When I run "rm -rf /tmp/kolu-clear-selected-browse && git init /tmp/kolu-clear-selected-browse && cd /tmp/kolu-clear-selected-browse"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'old content\n' > obsolete.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "obsolete.txt" in the file browser
    Then the file content should contain "old content"
    When I click the terminal canvas
    And I run "rm obsolete.txt"
    Then the file browser should not show a file "obsolete.txt"
    And the Code tab content should show the select hint "Select a file to view its content"
