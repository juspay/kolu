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

  # ── Local mode: file list + diff rendering ──

  Scenario: Lists changed files and opens a diff on click
    When I run "git init /tmp/kolu-review-dirty && cd /tmp/kolu-review-dirty"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\n' > note.txt"
    And I click the Code tab
    And I click the refresh button in the Code tab
    Then the Code tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Code tab
    Then the Code tab should render a diff view

  Scenario: Untracked files appear alongside modified tracked files
    When I run "git init /tmp/kolu-review-untracked && cd /tmp/kolu-review-untracked"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'initial\n' > tracked.txt && git add tracked.txt && git commit -m 'add tracked'"
    And I run "printf 'modified\n' > tracked.txt"
    And I run "printf 'new\n' > untracked.txt"
    And I click the Code tab
    And I click the refresh button in the Code tab
    Then the Code tab should list a changed file "tracked.txt"
    And the Code tab should list a changed file "untracked.txt"

  # ── Pierre tree behaviour: directory grouping + collapse ──

  Scenario: Groups files into a directory tree
    When I run "git init /tmp/kolu-review-tree && cd /tmp/kolu-review-tree"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/components && printf 'a\n' > src/index.ts && printf 'b\n' > src/components/Button.tsx"
    And I click the Code tab
    And I click the refresh button in the Code tab
    Then the Code tab should show a directory node "src"
    And the Code tab should list a changed file "src/index.ts"
    And the Code tab should list a changed file "src/components/Button.tsx"

  Scenario: Collapsing a directory hides its children
    When I run "git init /tmp/kolu-review-collapse && cd /tmp/kolu-review-collapse"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p pkg && printf 'x\n' > pkg/a.ts && printf 'y\n' > pkg/b.ts"
    And I click the Code tab
    And I click the refresh button in the Code tab
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
    And I click the refresh button in the Code tab
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

  # Regression: switching diff files used to leave the previous file's path
  # in the "Copy path:line" context-menu entry. The line number tracked the
  # new file but the path stayed stale, so users copying refs after switching
  # files got `<old-file>:<new-line>` — wrong filename, plausible-looking
  # line, no error. Root cause: the `<Match when={diff()}>{(d) => …}` callback
  # captured `selectedPath()` to a `const`, which is non-reactive (Solid runs
  # the callback once when the match becomes active).
  Scenario: Switching diff files keeps the "Copy path:line" entry in sync
    When I run "git init /tmp/kolu-diff-multifile && cd /tmp/kolu-diff-multifile"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'a-one\na-two\na-three\n' > file-a.txt"
    And I run "printf 'b-one\nb-two\nb-three\n' > file-b.txt"
    And I click the Code tab
    And I click the refresh button in the Code tab
    Then the Code tab should list a changed file "file-a.txt"
    And the Code tab should list a changed file "file-b.txt"
    When I click the changed file "file-a.txt" in the Code tab
    And I click the line number 1 in the diff view
    And I right-click the diff view
    And I click the context menu item "Copy file-a.txt:1"
    Then the clipboard should contain "file-a.txt:1"
    When I click the changed file "file-b.txt" in the Code tab
    And I click the line number 1 in the diff view
    And I right-click the diff view
    And I click the context menu item "Copy file-b.txt:1"
    Then the clipboard should contain "file-b.txt:1"
    And the clipboard should not contain "file-a.txt"
