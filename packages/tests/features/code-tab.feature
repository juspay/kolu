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

  Scenario: Code tab is present and switchable
    When I click the Code tab
    Then the Code tab should be active

  Scenario: Shows "not a git repo" message outside a repo
    When I run "cd /tmp"
    And I click the Code tab
    Then the Code tab should indicate no git repository

  Scenario: Shows "no changes" when the repo is clean
    When I run "rm -rf /tmp/kolu-review-clean && git init /tmp/kolu-review-clean && cd /tmp/kolu-review-clean"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should show the empty-changes message for repo "/tmp/kolu-review-clean"

  Scenario: Mode toggle defaults to browse
    When I run "rm -rf /tmp/kolu-review-toggle && git init /tmp/kolu-review-toggle && cd /tmp/kolu-review-toggle"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    Then the Code tab mode should be "browse"

  Scenario: Code tab mode survives panel close and reopen
    When I run "rm -rf /tmp/kolu-review-mode-persist && git init /tmp/kolu-review-mode-persist && cd /tmp/kolu-review-mode-persist"
    And I run "git commit --allow-empty -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    When I press the toggle inspector shortcut
    Then the right panel should not be visible
    When I press the toggle inspector shortcut
    Then the right panel should be visible
    And the Code tab mode should be "browse"

  Scenario: A mode's change count shows on its segment without switching into it
    When I run "rm -rf /tmp/kolu-review-badge && git init /tmp/kolu-review-badge && cd /tmp/kolu-review-badge"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'one\n' > a.txt"
    And I run "printf 'two\n' > b.txt"
    And I click the Code tab
    Then the Code tab mode should be "browse"
    And the Code tab "local" segment should show a change count of "2"
    And the Code tab "browse" segment should show no change count
    When I click the Code tab mode "local"
    Then the Code tab "local" segment should show a change count of "2"

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

  Scenario Outline: Selected file survives switching to another terminal and back [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I create a terminal
    And I run "rm -rf /tmp/kolu-codetab-otherdir && mkdir -p /tmp/kolu-codetab-otherdir && cd /tmp/kolu-codetab-otherdir"
    And I click dock row 1
    Then the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario: Browse preview follows the active terminal when two repos pick the same filename
    Given a Code tab in "browse" mode showing file "shared.txt" with content "from-A"
    When I open file "shared.txt" in the Code tab
    Then the selected file should show content "from-A"
    When I create a terminal
    Given a Code tab in "browse" mode showing file "shared.txt" with content "from-B"
    When I open file "shared.txt" in the Code tab
    Then the selected file should show content "from-B"
    When I click dock row 1
    Then the selected file should show content "from-A"
    When I click dock row 2
    Then the selected file should show content "from-B"

  Scenario: Browse preview survives terminal switch when filenames differ across repos
    Given a Code tab in "browse" mode showing file "file-a.txt" with content "AAAA"
    When I open file "file-a.txt" in the Code tab
    Then the selected file should show content "AAAA"
    When I create a terminal
    Given a Code tab in "browse" mode showing file "file-b.txt" with content "BBBB"
    When I open file "file-b.txt" in the Code tab
    Then the selected file should show content "BBBB"
    When I click dock row 1
    Then the selected file should show content "AAAA"
    When I click dock row 2
    Then the selected file should show content "BBBB"
    When I click dock row 1
    Then the selected file should show content "AAAA"
    When I click dock row 2
    Then the selected file should show content "BBBB"
    When I click dock row 1
    Then the selected file should show content "AAAA"

  Scenario: Manual selection survives a terminal round-trip after a file-ref click
    When I run "rm -rf /tmp/kolu-stale-pending-a && git init /tmp/kolu-stale-pending-a && cd /tmp/kolu-stale-pending-a"
    And I run "printf 'initial-A\n' > initial.txt && printf 'clicked-A\n' > clicked.txt && printf 'manual-A\n' > manual.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "initial.txt" in the file browser
    Then the selected file should show content "initial-A"
    When I create a terminal
    And I run "rm -rf /tmp/kolu-stale-pending-b && git init /tmp/kolu-stale-pending-b && cd /tmp/kolu-stale-pending-b"
    And I run "printf 'other-B\n' > other.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "other.txt" in the file browser
    Then the selected file should show content "other-B"
    When I click dock row 1
    And I run "echo 'jump to clicked.txt:1 now'"
    And I trigger the terminal file-ref link "clicked.txt:1"
    Then the selected file should show content "clicked-A"
    When I click the file "manual.txt" in the file browser
    Then the selected file should show content "manual-A"
    When I click dock row 2
    Then the selected file should show content "other-B"
    When I click dock row 1
    Then the selected file should show content "manual-A"

  Scenario: A terminal-clicked file survives a terminal round-trip
    When I run "rm -rf /tmp/kolu-clicked-persist-a && git init /tmp/kolu-clicked-persist-a && cd /tmp/kolu-clicked-persist-a"
    And I run "printf 'initial-A\n' > initial.txt && printf 'clicked-A\n' > clicked.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "initial.txt" in the file browser
    Then the selected file should show content "initial-A"
    When I create a terminal
    And I run "rm -rf /tmp/kolu-clicked-persist-b && git init /tmp/kolu-clicked-persist-b && cd /tmp/kolu-clicked-persist-b"
    And I run "printf 'other-B\n' > other.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "other.txt" in the file browser
    Then the selected file should show content "other-B"
    When I click dock row 1
    And I run "echo 'jump to clicked.txt:1 now'"
    And I trigger the terminal file-ref link "clicked.txt:1"
    Then the selected file should show content "clicked-A"
    When I click dock row 2
    Then the selected file should show content "other-B"
    When I click dock row 1
    Then the selected file should show content "clicked-A"

  Scenario Outline: Selected file survives page refresh [<mode>]
    Given a Code tab in "<mode>" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I wait for the session auto-save
    And I reload the page and wait for ready
    Then the right panel should be visible
    And the Code tab mode should be "<mode>"
    And the selected file should show content "aaa"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario: Lists changed files and opens a diff on click
    When I run "rm -rf /tmp/kolu-review-dirty && git init /tmp/kolu-review-dirty && cd /tmp/kolu-review-dirty"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\n' > note.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Code tab
    Then the Code tab should render a diff view

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

  Scenario Outline: Folder collapse during active filter persists the filter [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path              | content |
      | src/alpha-one.txt | a1      |
      | src/alpha-two.txt | a2      |
      | other.txt         | o       |
    When I type "alpha" into the Code tab filter
    Then the Code tab should show file "src/alpha-one.txt"
    And the Code tab should show file "src/alpha-two.txt"
    And the Code tab should not show file "other.txt"
    When I click the directory node "src" in the Code tab
    Then the Code tab should not show file "src/alpha-one.txt"
    And the Code tab should not show file "src/alpha-two.txt"
    And the Code tab filter input should contain "alpha"
    And the Code tab should not show file "other.txt"
    When a file the filter does not match is added to the Code tab repo
    Then the Code tab should not show file "src/alpha-one.txt"
    And the Code tab should not show file "src/alpha-two.txt"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario Outline: Filter prunes directories with no matching files [<mode>]
    Given a Code tab in "<mode>" mode showing files:
      | path               | content |
      | docs/keep.md       | keep    |
      | docs/plans/note.md | note    |
      | widgets/list/a.ts  | a       |
      | widgets/forms/b.ts | b       |
    When I type "docs keep" into the Code tab filter
    Then the Code tab should show file "docs/keep.md"
    And the Code tab should show a directory node "docs"
    And the Code tab should not show file "widgets/list/a.ts"
    And the Code tab should not show a directory node "widgets"

    Examples:
      | mode   |
      | local  |
      | branch |
      | browse |

  Scenario: Untracked files appear alongside modified tracked files
    When I run "rm -rf /tmp/kolu-review-untracked && git init /tmp/kolu-review-untracked && cd /tmp/kolu-review-untracked"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'initial\n' > tracked.txt && git add tracked.txt && git commit -m 'add tracked'"
    And I run "printf 'modified\n' > tracked.txt"
    And I run "printf 'new\n' > untracked.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "tracked.txt"
    And the Code tab should list a changed file "untracked.txt"

  Scenario: Groups files into a directory tree
    When I run "rm -rf /tmp/kolu-review-tree && git init /tmp/kolu-review-tree && cd /tmp/kolu-review-tree"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p src/components && printf 'a\n' > src/index.ts && printf 'b\n' > src/components/Button.tsx"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should show a directory node "src"
    And the Code tab should list a changed file "src/index.ts"
    And the Code tab should list a changed file "src/components/Button.tsx"

  Scenario: Collapsing a directory hides its children
    When I run "rm -rf /tmp/kolu-review-collapse && git init /tmp/kolu-review-collapse && cd /tmp/kolu-review-collapse"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p pkg && printf 'x\n' > pkg/a.ts && printf 'y\n' > pkg/b.ts"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "pkg/a.ts"
    When I click the directory node "pkg" in the Code tab
    Then the Code tab should not list a changed file "pkg/a.ts"
    When I click the directory node "pkg" in the Code tab
    Then the Code tab should list a changed file "pkg/a.ts"

  Scenario: Right-click on a changed file copies its path
    When I run "rm -rf /tmp/kolu-tree-ctx && git init /tmp/kolu-tree-ctx && cd /tmp/kolu-tree-ctx"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p api && printf 'q\n' > api/handler.ts"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "api/handler.ts"
    When I right-click the changed file "api/handler.ts" in the Code tab
    And I click the context menu item "Copy path"
    Then the clipboard should contain "api/handler.ts"

  Scenario: Right-click Download on a file saves it under its base name
    When I run "rm -rf /tmp/kolu-tree-download && git init /tmp/kolu-tree-download && cd /tmp/kolu-tree-download"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p api && printf 'download-me\n' > api/handler.ts"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "api/handler.ts"
    When I right-click the changed file "api/handler.ts" in the Code tab
    And I download the context menu item "Download"
    Then the downloaded file should be named "handler.ts" containing "download-me"

  Scenario: A directory row offers no Download
    When I run "rm -rf /tmp/kolu-tree-download-dir && git init /tmp/kolu-tree-download-dir && cd /tmp/kolu-tree-download-dir"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p pkg && printf 'x\n' > pkg/a.ts"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "pkg/a.ts"
    When I right-click the directory node "pkg" in the Code tab
    Then the tree context menu should not offer "Download"

  Scenario: A deleted file offers no Download
    When I run "rm -rf /tmp/kolu-tree-download-gone && git init /tmp/kolu-tree-download-gone && cd /tmp/kolu-tree-download-gone"
    And I run "printf 'bye\n' > gone.txt && git add . && git commit -m init"
    And I run "rm gone.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "gone.txt"
    When I right-click the changed file "gone.txt" in the Code tab
    Then the tree context menu should not offer "Download"

  Scenario: Right-click in All files opens the Local diff of that file
    When I run "rm -rf /tmp/kolu-tree-tolocal && git init /tmp/kolu-tree-tolocal && cd /tmp/kolu-tree-tolocal"
    And I run "printf 'one\n' > seed.txt && git add . && git commit -m init"
    And I run "printf 'two\n' >> seed.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    When I right-click the changed file "seed.txt" in the Code tab
    And I click the context menu item "Open Local diff"
    Then the Code tab mode should be "local"
    And the file "seed.txt" should be selected in the file browser
    And the Code tab should render a diff view

  Scenario: Right-click in All files opens the Branch diff of that file
    Given a Code tab in "branch" mode showing file "seed.txt" with content "two"
    When I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    When I right-click the changed file "seed.txt" in the Code tab
    And I click the context menu item "Open Branch diff"
    Then the Code tab mode should be "branch"
    And the file "seed.txt" should be selected in the file browser
    And the Code tab should render a diff view

  Scenario: Right-click in a git diff returns to All files
    When I run "rm -rf /tmp/kolu-tree-tobrowse && git init /tmp/kolu-tree-tobrowse && cd /tmp/kolu-tree-tobrowse"
    And I run "printf 'one\n' > seed.txt && git add . && git commit -m init"
    And I run "printf 'two\n' >> seed.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab mode should be "local"
    And the Code tab should list a changed file "seed.txt"
    When I right-click the changed file "seed.txt" in the Code tab
    And I click the context menu item "Open in All files"
    Then the Code tab mode should be "browse"
    And the file "seed.txt" should be selected in the file browser

  Scenario: File browser shows the repo file tree
    When I run "rm -rf /tmp/kolu-browse-tree && git init /tmp/kolu-browse-tree && cd /tmp/kolu-browse-tree"
    And I run "mkdir -p src && printf 'a\n' > README.md && printf 'b\n' > src/index.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    And the file browser should show a directory "src"
    And the file browser should show a file "README.md"

  Scenario: File browser shows file content on click
    When I run "rm -rf /tmp/kolu-browse-content && git init /tmp/kolu-browse-content && cd /tmp/kolu-browse-content"
    And I run "printf 'hello world\n' > greeting.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "greeting.txt" in the file browser
    Then the file content should contain "hello world"

  Scenario: Code tab back and forward retrace file navigation
    Given a Code tab in "browse" mode showing files:
      | path  | content |
      | a.txt | aaa     |
      | b.txt | bbb     |
      | c.txt | ccc     |
    When I click the file "a.txt" in the file browser
    Then the selected file should show content "aaa"
    And the Code tab "back" button should be disabled
    When I click the file "b.txt" in the file browser
    Then the selected file should show content "bbb"
    When I click the file "c.txt" in the file browser
    Then the selected file should show content "ccc"
    And the Code tab "forward" button should be disabled
    When I go back in the Code tab
    Then the selected file should show content "bbb"
    When I go back in the Code tab
    Then the selected file should show content "aaa"
    When I go forward in the Code tab
    Then the selected file should show content "bbb"
    When I go forward in the Code tab
    Then the selected file should show content "ccc"
    And the Code tab "forward" button should be disabled

  Scenario: Code tab back/forward crosses modes and records right-click "Open in" jumps
    When I run "rm -rf /tmp/kolu-nav-cross && git init /tmp/kolu-nav-cross && cd /tmp/kolu-nav-cross"
    And I run "printf 'alpha-line\n' > alpha.txt && printf 'beta-line\n' > beta.txt"
    And I run "git add . && git commit -m init"
    And I run "printf 'beta-extra\n' >> beta.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab mode should be "browse"
    When I click the file "alpha.txt" in the file browser
    Then the selected file should show content "alpha-line"
    And the Code tab "back" button should be disabled
    When I click the file "beta.txt" in the file browser
    Then the selected file should show content "beta-line"
    When I right-click the changed file "beta.txt" in the Code tab
    And I click the context menu item "Open Local diff"
    Then the Code tab mode should be "local"
    And the file "beta.txt" should be selected in the file browser
    And the Code tab should render a diff view
    And the Code tab "forward" button should be disabled
    When I go back in the Code tab
    Then the Code tab mode should be "browse"
    And the file "beta.txt" should be selected in the file browser
    And the selected file should show content "beta-line"
    When I go back in the Code tab
    Then the Code tab mode should be "browse"
    And the file "alpha.txt" should be selected in the file browser
    And the selected file should show content "alpha-line"
    And the Code tab "back" button should be disabled
    When I go forward in the Code tab
    Then the Code tab mode should be "browse"
    And the selected file should show content "beta-line"
    When I go forward in the Code tab
    Then the Code tab mode should be "local"
    And the file "beta.txt" should be selected in the file browser
    And the Code tab should render a diff view
    And the Code tab "forward" button should be disabled

  Scenario: Right-click "Open in All files" from a diff records history
    When I run "rm -rf /tmp/kolu-nav-tobrowse && git init /tmp/kolu-nav-tobrowse && cd /tmp/kolu-nav-tobrowse"
    And I run "printf 'one\n' > seed.txt && git add . && git commit -m init"
    And I run "printf 'two\n' >> seed.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab mode should be "local"
    And the Code tab should list a changed file "seed.txt"
    When I click the file "seed.txt" in the file browser
    Then the Code tab should render a diff view
    And the Code tab "back" button should be disabled
    When I right-click the changed file "seed.txt" in the Code tab
    And I click the context menu item "Open in All files"
    Then the Code tab mode should be "browse"
    And the file "seed.txt" should be selected in the file browser
    And the Code tab "back" button should be enabled
    When I go back in the Code tab
    Then the Code tab mode should be "local"
    And the Code tab should render a diff view
    When I go forward in the Code tab
    Then the Code tab mode should be "browse"
    And the file "seed.txt" should be selected in the file browser

  Scenario: Code tab forward history is truncated when navigating after going back
    Given a Code tab in "browse" mode showing files:
      | path  | content |
      | a.txt | aaa     |
      | b.txt | bbb     |
      | c.txt | ccc     |
    When I click the file "a.txt" in the file browser
    Then the selected file should show content "aaa"
    When I click the file "b.txt" in the file browser
    Then the selected file should show content "bbb"
    When I click the file "c.txt" in the file browser
    Then the selected file should show content "ccc"
    When I go back in the Code tab
    Then the selected file should show content "bbb"
    When I go back in the Code tab
    Then the selected file should show content "aaa"
    When I click the file "c.txt" in the file browser
    Then the selected file should show content "ccc"
    And the Code tab "forward" button should be disabled
    When I go back in the Code tab
    Then the selected file should show content "aaa"
    When I go forward in the Code tab
    Then the selected file should show content "ccc"
    And the Code tab "forward" button should be disabled

  Scenario: Code tab history is scoped per repo — back cannot cross a cd into another repo
    When I run "rm -rf /tmp/kolu-hist-a && git init /tmp/kolu-hist-a && cd /tmp/kolu-hist-a"
    And I run "printf 'from-repo-A\n' > shared.txt && printf 'only-in-A\n' > a-only.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "a-only.txt" in the file browser
    Then the selected file should show content "only-in-A"
    When I click the file "shared.txt" in the file browser
    Then the selected file should show content "from-repo-A"
    And the Code tab "back" button should be enabled
    When I run "rm -rf /tmp/kolu-hist-b && git init /tmp/kolu-hist-b && cd /tmp/kolu-hist-b"
    And I run "printf 'from-repo-B\n' > shared.txt && git add . && git commit -m init"
    When I click the file "shared.txt" in the file browser
    Then the selected file should show content "from-repo-B"
    And the Code tab "back" button should be disabled

  Scenario: Code tab history survives switching between terminals in different repos
    When I run "rm -rf /tmp/kolu-hist-term-a && git init /tmp/kolu-hist-term-a && cd /tmp/kolu-hist-term-a"
    And I run "printf 'one-A\n' > one.txt && printf 'two-A\n' > two.txt && printf 'a\n' > only-in-a.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And the file browser should show a file "only-in-a.txt"
    When I click the file "one.txt" in the file browser
    Then the selected file should show content "one-A"
    When I click the file "two.txt" in the file browser
    Then the selected file should show content "two-A"
    And the Code tab "back" button should be enabled
    When I create a terminal
    And I run "rm -rf /tmp/kolu-hist-term-b && git init /tmp/kolu-hist-term-b && cd /tmp/kolu-hist-term-b"
    And I run "printf 'one-B\n' > one.txt && printf 'two-B\n' > two.txt && printf 'b\n' > only-in-b.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And the file browser should show a file "only-in-b.txt"
    When I click the file "one.txt" in the file browser
    Then the selected file should show content "one-B"
    When I click the file "two.txt" in the file browser
    Then the selected file should show content "two-B"
    And the Code tab "back" button should be enabled
    When I click dock row 1
    Then the selected file should show content "two-A"
    And the file browser should show a file "only-in-a.txt"
    And the Code tab "back" button should be enabled
    When I go back in the Code tab
    Then the selected file should show content "one-A"
    When I click dock row 2
    Then the selected file should show content "two-B"
    And the file browser should show a file "only-in-b.txt"
    And the Code tab "back" button should be enabled
    When I go back in the Code tab
    Then the selected file should show content "one-B"

  Scenario: File browser wraps long lines by default
    When I run "rm -rf /tmp/kolu-browse-wrap && git init /tmp/kolu-browse-wrap && cd /tmp/kolu-browse-wrap"
    And I run "printf 'prefix-' > long.txt && printf '%*s' 240 '' | tr ' ' x >> long.txt && printf '\n' >> long.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "long.txt" in the file browser
    Then the file content should contain "prefix-"
    And the file content should wrap long lines

  Scenario: Browse mode decorates changed files with git status
    When I run "rm -rf /tmp/kolu-browse-gitstatus && git init /tmp/kolu-browse-gitstatus && cd /tmp/kolu-browse-gitstatus"
    And I run "printf 'tracked\n' > tracked.txt && printf 'stable\n' > stable.txt && git add . && git commit -m init"
    And I run "printf 'edited\n' > tracked.txt"
    And I run "printf 'brand new\n' > fresh.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab should show file "stable.txt"
    And the Code tab file "tracked.txt" should have git status "modified"
    And the Code tab file "fresh.txt" should have git status "untracked"
    And the Code tab file "stable.txt" should have no git status

  Scenario: Browse mode tints ancestor folders that contain a change
    When I run "rm -rf /tmp/kolu-browse-foldertint && git init /tmp/kolu-browse-foldertint && cd /tmp/kolu-browse-foldertint"
    And I run "mkdir -p src/feature lib seed && printf 'a\n' > src/feature/a.txt && printf 'k\n' > src/keep.txt && printf 'b\n' > lib/b.txt && printf 'seed\n' > seed/dirty.txt && git add . && git commit -m init"
    And I run "printf 'seed-edited\n' > seed/dirty.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab directory "seed" should be marked as containing a change while nudging file "/tmp/kolu-browse-foldertint/seed/dirty.txt"
    And the Code tab directory "seed" name should be tinted differently from directory "lib"
    And the Code tab directory "src" should not be marked as containing a change
    When I run "printf 'edited\n' > src/feature/a.txt"
    Then the Code tab directory "src" should be marked as containing a change while nudging file "/tmp/kolu-browse-foldertint/src/feature/a.txt"
    And the Code tab directory "lib" should not be marked as containing a change
    And the Code tab directory "src" name should be tinted differently from directory "lib"

  Scenario: HTML file renders in an iframe instead of as code
    When I run "rm -rf /tmp/kolu-iframe-html && git init /tmp/kolu-iframe-html && cd /tmp/kolu-iframe-html"
    And I run "printf '<!doctype html><h1>preview</h1>\n' > page.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "page.html" in the file browser
    Then the file preview iframe should be visible

  Scenario: SVG file renders in the iframe preview
    When I run "rm -rf /tmp/kolu-iframe-svg && git init /tmp/kolu-iframe-svg && cd /tmp/kolu-iframe-svg"
    And I run "printf '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\"/>\n' > logo.svg"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "logo.svg" in the file browser
    Then the file preview iframe should be visible

  Scenario: PDF file renders in the native PDF viewer, not the sandboxed iframe
    When I run "rm -rf /tmp/kolu-pdf-doc && git init /tmp/kolu-pdf-doc && cd /tmp/kolu-pdf-doc"
    And I run "printf 'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0OCA+PgpzdHJlYW0KQlQKL0YxIDE4IFRmCjIwIDEwMCBUZAooS29sdSBQREYgcHJldmlldykgVGoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMzggMDAwMDAgbiAKdHJhaWxlcgo8PCAvUm9vdCAxIDAgUiAvU2l6ZSA2ID4+CnN0YXJ0eHJlZgo0MDgKJSVFT0YK' | base64 -d > doc.pdf"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "doc.pdf" in the file browser
    Then the file preview PDF should be visible
    And the file preview iframe should not be visible

  Scenario: PNG image renders as an <img> preview, not an iframe
    When I run "rm -rf /tmp/kolu-img-png && git init /tmp/kolu-img-png && cd /tmp/kolu-img-png"
    And I run "printf 'PNG\0fake\1\2\3\4' > icon.png"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "icon.png" in the file browser
    Then the file preview image should be visible
    And the file preview iframe should not be visible

  Scenario: Video file renders as a <video> preview, not an iframe
    When I run "rm -rf /tmp/kolu-vid-mp4 && git init /tmp/kolu-vid-mp4 && cd /tmp/kolu-vid-mp4"
    And I run "printf 'fake\0mp4\1\2\3\4' > clip.mp4"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "clip.mp4" in the file browser
    Then the file preview video should be visible
    And the file preview iframe should not be visible

  Scenario: Plain text file still renders as syntax-highlighted code (no iframe)
    When I run "rm -rf /tmp/kolu-iframe-text && git init /tmp/kolu-iframe-text && cd /tmp/kolu-iframe-text"
    And I run "printf 'hello\n' > note.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "note.txt" in the file browser
    Then the file content should contain "hello"
    And the file preview iframe should not be visible

  Scenario: Markdown renders as a document by default, with a Source/Rendered toggle
    When I run "rm -rf /tmp/kolu-md-doc && git init /tmp/kolu-md-doc && cd /tmp/kolu-md-doc"
    And I run "printf '# Hello Doc\n\nRendered body text.\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Hello Doc"
    And the file view toggle should be visible
    And the file preview iframe should not be visible

  Scenario: MDX files preview as Markdown, not Source-only
    When I run "rm -rf /tmp/kolu-mdx-doc && git init /tmp/kolu-mdx-doc && cd /tmp/kolu-mdx-doc"
    And I run "printf '# Hello MDX\n\nRendered mdx body.\n' > note.mdx"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "note.mdx" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Hello MDX"
    And the file view toggle should be visible
    And the file preview iframe should not be visible

  Scenario: Truncated Markdown warns and renders task checkboxes read-only
    When I run "rm -rf /tmp/kolu-md-trunc && git init /tmp/kolu-md-trunc && cd /tmp/kolu-md-trunc"
    And I run "printf '# Truncated Doc\n\nbody marker\n\n- [ ] guard me\n\n' > big.md && head -c 1100000 /dev/zero | tr '\0' 'x' >> big.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "big.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Truncated Doc"
    And the markdown preview should show the truncation warning
    And the markdown preview should render a "input[type=checkbox][disabled]" element
    And the markdown preview should not render a "input[data-md-task]" element

  Scenario: Markdown preview draws a mermaid block as a diagram
    When I run "rm -rf /tmp/kolu-md-mermaid && git init /tmp/kolu-md-mermaid && cd /tmp/kolu-md-mermaid"
    And I run "printf '# Diagram Doc\n\n```mermaid\nflowchart TD\n  A[Start] --> B[Finish]\n```\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Diagram Doc"
    And the markdown preview should show a painted diagram
    And the page should hold no diagram renderer frame
    And the markdown preview should not contain "flowchart TD"
    And the markdown preview should not render a "svg" element
    And there should be no page errors

  Scenario: A mermaid block that cannot be drawn says why and keeps its source
    When I run "rm -rf /tmp/kolu-md-mermaid-bad && git init /tmp/kolu-md-mermaid-bad && cd /tmp/kolu-md-mermaid-bad"
    And I run "printf '# Broken Diagram\n\n```mermaid\nflowchart TD\n  A[unclosed --> B\n```\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Parse error"
    And the markdown preview should contain "A[unclosed --> B"
    And the markdown preview should not render a "figure[data-md-diagram]" element

  Scenario: Markdown source toggle reveals the raw markdown
    When I run "rm -rf /tmp/kolu-md-src && git init /tmp/kolu-md-src && cd /tmp/kolu-md-src"
    And I run "printf '# Heading One\n\nbody text\n' > notes.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "notes.md" in the file browser
    Then the markdown preview should be visible
    When I switch the file view to "source"
    Then the file content should contain "# Heading One"
    And the markdown preview should not be visible

  Scenario: Toggling Source and Rendered keeps the rendered preview alive
    When I run "rm -rf /tmp/kolu-md-keepalive && git init /tmp/kolu-md-keepalive && cd /tmp/kolu-md-keepalive"
    And I run "printf '# Keep Alive\n\nbody text\n' > notes.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "notes.md" in the file browser
    Then the markdown preview should be visible
    When I mark the rendered markdown preview
    And I switch the file view to "source"
    Then the markdown preview should not be visible
    When I switch the file view to "rendered"
    Then the markdown preview should be visible
    And the rendered markdown preview should be the kept-alive element

  Scenario: Markdown preview renders GFM tables, task lists, and inline HTML
    When I run "rm -rf /tmp/kolu-md-gfm && git init /tmp/kolu-md-gfm && cd /tmp/kolu-md-gfm"
    And I run "printf '# Doc Title\n\n| Col A | Col B |\n|:------|------:|\n| 1 | 2 |\n\n- [x] shipped\n- [ ] pending\n\nPress <kbd>Ctrl</kbd> to go.\n\n<p align=center>centered note</p>\n\n<img src=docs/logo.png alt=brand-logo />\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "h1" element
    And the markdown preview should contain "Doc Title"
    And the markdown preview should render a "table" element
    And the markdown preview should contain "Col A"
    And the markdown preview should render a "input[type=checkbox]" element
    And the markdown preview should render a "kbd" element
    And the markdown preview should render a "[align=center]" element
    And the markdown preview should contain "centered note"
    And the markdown preview should render a "img[src*='/api/terminals/']" element

  Scenario: Markdown preview renders YAML front-matter as a metadata table
    When I run "rm -rf /tmp/kolu-md-fm && git init /tmp/kolu-md-fm && cd /tmp/kolu-md-fm"
    And I run "printf -- '---\ntitle: Release Notes\nauthor: Jane Roe\ntags:\n  - markdown\n  - preview\n---\n\n# Body Heading\n\nReal body text.\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "table[data-md-frontmatter]" element
    And the markdown preview should contain "Release Notes"
    And the markdown preview should contain "Jane Roe"
    And the markdown preview should contain "markdown, preview"
    And the markdown preview should render a "h1" element
    And the markdown preview should contain "Body Heading"
    And the markdown preview should not render a "hr" element

  Scenario: Markdown preview strips script-capable HTML and links
    When I run "rm -rf /tmp/kolu-md-xss && git init /tmp/kolu-md-xss && cd /tmp/kolu-md-xss"
    And I run "printf '# Safe Render\n\nintro paragraph here\n\n<script>window.__xss=1</script>\n\n[evil link](javascript:window.__xss=2)\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Safe Render"
    And the markdown preview should contain "evil link"
    And the markdown preview should not render a "script" element
    And the markdown preview should not render a "a[href^=javascript]" element

  Scenario: Markdown preview drops style, class, SVG, and form controls
    When I run "rm -rf /tmp/kolu-md-tight && git init /tmp/kolu-md-tight && cd /tmp/kolu-md-tight"
    And I run "printf '# Tight Allowlist\n\n<p style=color:red class=takeover>styled para</p>\n\n<svg width=10 height=10><rect width=10 height=10 /></svg>\n\n<button>press me</button>\n\n<input type=text value=injected />\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "styled para"
    And the markdown preview should not render a "[style]" element
    And the markdown preview should not render a ".takeover" element
    And the markdown preview should not render a "svg" element
    And the markdown preview should not render a "button" element
    And the markdown preview should not render a "input[type=text]" element

  Scenario: Markdown preview applies the link policy to raw inline anchors
    When I run "rm -rf /tmp/kolu-md-rawa && git init /tmp/kolu-md-rawa && cd /tmp/kolu-md-rawa"
    And I run "printf '# Raw Anchors\n\n<a href=docs/guide.md>relative doc</a>\n\n<a href=https://example.com/>external link</a>\n\n<a href=javascript:1>raw evil</a>\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "relative doc"
    And the markdown preview should contain "external link"
    And the markdown preview should contain "raw evil"
    And the markdown preview should render a "a[data-md-rel]" element
    And the markdown preview should not render a "a[data-md-rel][target=_blank]" element
    And the markdown preview should render a "a[target=_blank]" element
    And the markdown preview should render a "a[rel~=noopener]" element
    And the markdown preview should not render a "a[href^=javascript]" element

  Scenario: Markdown preview does not let raw HTML spoof the wikilink marker
    When I run "rm -rf /tmp/kolu-md-wikispoof && git init /tmp/kolu-md-wikispoof && cd /tmp/kolu-md-wikispoof"
    And I run "printf '# Spoof\n\n<a data-md-wikilink href=https://evil.example/>spoofed link</a>\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "spoofed link"
    And the markdown preview should not render a "a[data-md-wikilink]" element
    And the markdown preview should render a "a[target=_blank]" element
    And the markdown preview should render a "a[rel~=noopener]" element

  Scenario: Markdown preview opens a repo-relative link in the Code tab
    When I run "rm -rf /tmp/kolu-md-rellink && git init /tmp/kolu-md-rellink && cd /tmp/kolu-md-rellink"
    And I run "mkdir -p docs && printf '# Guide Doc\n\nRelative target reached.\n' > docs/guide.md"
    And I run "printf '# Home\n\n[the guide](docs/guide.md)\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "a[data-md-rel]" element
    When I click the repo-relative markdown link "docs/guide.md"
    Then the file "docs/guide.md" should be selected in the file browser
    And the markdown preview should contain "Relative target reached"

  Scenario: Markdown relative link to a missing path does not open a same-basename file
    When I run "rm -rf /tmp/kolu-md-relexact && git init /tmp/kolu-md-relexact && cd /tmp/kolu-md-relexact"
    And I run "mkdir -p src && printf '# Other Guide\n\nWrong file.\n' > src/guide.md"
    And I run "printf '# Home\n\n[the guide](docs/guide.md)\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "a[data-md-rel]" element
    When I click the repo-relative markdown link "docs/guide.md"
    Then a toast should appear with text "File reference not found: docs/guide.md"
    And the file "src/guide.md" should not be selected in the file browser

  Scenario: Markdown preview opens a wikilink to the unique matching file
    When I run "rm -rf /tmp/kolu-md-wiki && git init /tmp/kolu-md-wiki && cd /tmp/kolu-md-wiki"
    And I run "mkdir -p docs/deep && printf '# Architecture Doc\n\nArch target reached.\n' > docs/deep/Architecture.md"
    And I run "printf '# Home\n\nsee [[Architecture]] for the design\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "a[data-md-wikilink]" element
    When I click the wikilink "Architecture"
    Then the file "docs/deep/Architecture.md" should be selected in the file browser
    And the markdown preview should contain "Arch target reached"

  Scenario: Ambiguous wikilink surfaces a disambiguation menu
    When I run "rm -rf /tmp/kolu-md-wikiamb && git init /tmp/kolu-md-wikiamb && cd /tmp/kolu-md-wikiamb"
    And I run "mkdir -p a b && printf 'alpha\n' > a/Note.md && printf 'beta\n' > b/Note.md && printf 'noise\n' > b/Note.txt"
    And I run "printf '# Home\n\nopen the [[Note]] doc\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "a[data-md-wikilink]" element
    When I click the wikilink "Note"
    Then the wikilink disambiguation menu should be visible
    When I click the wikilink candidate "b/Note.md"
    Then the file "b/Note.md" should be selected in the file browser

  Scenario: Wikilink implies only .md, not a same-stem sibling extension
    When I run "rm -rf /tmp/kolu-md-wikimd && git init /tmp/kolu-md-wikimd && cd /tmp/kolu-md-wikimd"
    And I run "mkdir -p docs/guide tests/features && printf '# Lua Filters\n\nFilters doc reached.\n' > docs/guide/lua-filters.md && printf 'Feature: lua filters\n' > tests/features/lua-filters.feature"
    And I run "printf '# Home\n\nconfigure [[lua-filters]] next\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    When I click the wikilink "lua-filters"
    Then the file "docs/guide/lua-filters.md" should be selected in the file browser
    And the markdown preview should contain "Filters doc reached"

  Scenario: Wikilink with no matching file surfaces a toast
    When I run "rm -rf /tmp/kolu-md-wikimiss && git init /tmp/kolu-md-wikimiss && cd /tmp/kolu-md-wikimiss"
    And I run "printf '# Home\n\nsee [[Nonexistent]] here\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    When I click the wikilink "Nonexistent"
    Then a toast should appear with text "No file matching [[Nonexistent]]"

  Scenario: Markdown preview renders lists, footnotes, alerts, and resolves repo images
    When I run "rm -rf /tmp/kolu-md-rich && git init /tmp/kolu-md-rich && cd /tmp/kolu-md-rich"
    And I run "printf '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><rect width=\"8\" height=\"8\"/></svg>' > logo.svg"
    And I run "printf '# Rich Doc\n\n![logo](logo.svg)\n\n- one\n- two\n\n1. a\n2. b\n\nclaim[^x]\n\n[^x]: the footnote\n\n> [!WARNING]\n> heads up\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "Rich Doc"
    And the markdown preview list markers should be visible
    And the markdown preview should render a "section" element
    And the markdown preview should render a "sup a" element
    And the markdown preview should not contain "[^x]"
    And the markdown preview should render a "[data-md-alert=warning]" element
    And the markdown preview should render a "img[src*='/api/terminals/']" element
    And the markdown preview should not render a "span.kolu-md-img-fallback" element

  Scenario: Markdown preview highlights code, folds soft breaks, and renders task checkboxes
    When I run "rm -rf /tmp/kolu-md-rich2 && git init /tmp/kolu-md-rich2 && cd /tmp/kolu-md-rich2"
    And I run "printf '# Doc\n\nline one\nline two\n\n```js\nconst x = 1;\n```\n\n- [ ] todo item\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "div.kolu-md-code" element
    And the markdown preview should render a "button.kolu-md-copy" element
    And the markdown preview should render a "pre.shiki" element
    And the markdown preview should not render a "p br" element
    And the markdown preview should render a "input[type=checkbox][disabled]" element

  Scenario: Markdown preview opens a footnote definition in a click popover
    When I run "rm -rf /tmp/kolu-md-fnpop && git init /tmp/kolu-md-fnpop && cd /tmp/kolu-md-fnpop"
    And I run "printf '# Guide Doc\n\nFootnote target reached.\n' > guide.md"
    And I run "printf '# Doc\n\nclaim[^big] and more[^two]\n\n[^big]: see [the guide](guide.md) and also[^two]\n\n[^two]: a second note\n' > README.md"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should render a "section" element
    And the markdown preview should render a "sup a[data-md-footnote]" element
    When I click footnote marker "1"
    Then the footnote popover should be visible
    And the footnote popover should contain "the guide"
    And the footnote popover should render a "a[data-md-rel]" element
    And the footnote popover should not render a "a[data-md-footnote]" element
    And the footnote popover should not render a "a[data-md-footnote-backref]" element
    When I click footnote marker "1"
    Then the footnote popover should not be visible
    When I click footnote marker "1"
    Then the footnote popover should be visible
    When I click the footnote popover see-all link
    Then the footnote popover should not be visible
    When I click footnote marker "1"
    Then the footnote popover should be visible
    When I click the repo-relative link "guide.md" in the footnote popover
    Then the file "guide.md" should be selected in the file browser
    And the markdown preview should contain "Footnote target reached"

  Scenario: Tree/content split has a draggable handle
    When I run "rm -rf /tmp/kolu-tree-resize && git init /tmp/kolu-tree-resize && cd /tmp/kolu-tree-resize"
    And I run "printf 'hello\n' > note.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the Code tab tree pane split handle should be visible

  Scenario: Tree/content split survives switching to another terminal and back
    Given a Code tab in "browse" mode showing file "a.txt" with content "aaa"
    When I open file "a.txt" in the Code tab
    Then the selected file should show content "aaa"
    When I note the Code tab preview pane height
    And I drag the Code tab tree/content split handle up by 80 pixels
    Then the Code tab preview pane should be about 80 pixels taller than noted
    When I note the Code tab preview pane height
    And I create a terminal
    And I run "rm -rf /tmp/kolu-split-otherdir && mkdir -p /tmp/kolu-split-otherdir && cd /tmp/kolu-split-otherdir"
    Then the Code tab should indicate no git repository
    When I click dock row 1
    Then the selected file should show content "aaa"
    And the Code tab preview pane height should match the noted height

  Scenario: File browser expands directories lazily
    When I run "rm -rf /tmp/kolu-browse-expand && git init /tmp/kolu-browse-expand && cd /tmp/kolu-browse-expand"
    And I run "mkdir -p lib && printf 'x\n' > lib/util.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the file browser should show a directory "lib"
    When I click the directory "lib" in the file browser
    Then the file browser should show a file "lib/util.ts"

  Scenario: A gitignored folder stays open when you open a file inside it
    When I run "rm -rf /tmp/kolu-ignored-stay && git init /tmp/kolu-ignored-stay && cd /tmp/kolu-ignored-stay"
    And I run "mkdir -p .waterfall && printf 'brief-marker\n' > .waterfall/brief.txt && printf 'notes\n' > .waterfall/notes.txt"
    And I run "printf 'tracked\n' > kept.md && git add kept.md && git commit -m init"
    And I run "printf '.waterfall/\n' >> .git/info/exclude"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the file browser should show a file "kept.md"
    And the file browser should not show a directory ".waterfall"
    When I click the show-gitignored toggle
    Then the file browser should show a directory ".waterfall"
    When I click the directory ".waterfall" in the file browser
    Then the file browser should show a file ".waterfall/brief.txt"
    When I click the file ".waterfall/brief.txt" in the file browser
    Then the file content should contain "brief-marker"
    And the directory ".waterfall" should stay expanded in the file browser
    And the file browser should show a file ".waterfall/notes.txt"
    And the file ".waterfall/brief.txt" should be selected in the file browser
    And the file content should contain "brief-marker"
    And there should be no page errors

  Scenario: File browser preserves sibling expansion when previewing a file
    When I run "rm -rf /tmp/kolu-browse-keep && git init /tmp/kolu-browse-keep && cd /tmp/kolu-browse-keep"
    And I run "mkdir -p alpha beta && printf 'a1\n' > alpha/a1.txt && printf 'a2\n' > alpha/a2.txt && printf 'b1\n' > beta/b1.txt && printf 'b2\n' > beta/b2.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "alpha" in the file browser
    Then the file browser should show a file "alpha/a1.txt"
    When I click the directory "beta" in the file browser
    Then the file browser should show a file "beta/b1.txt"
    When I click the file "beta/b1.txt" in the file browser
    Then the file "beta/b1.txt" should be selected in the file browser
    And the file browser should show a file "alpha/a1.txt"

  Scenario: File browser keeps a folder expanded across a filter and clear
    When I run "rm -rf /tmp/kolu-browse-filter && git init /tmp/kolu-browse-filter && cd /tmp/kolu-browse-filter"
    And I run "mkdir -p alpha beta && printf 'a1\n' > alpha/a1.txt && printf 'a2\n' > alpha/a2.txt && printf 'b1\n' > beta/b1.txt && printf 'b2\n' > beta/b2.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "alpha" in the file browser
    Then the file browser should show a file "alpha/a1.txt"
    When I click the directory "beta" in the file browser
    Then the file browser should show a file "beta/b1.txt"
    When I type "a1" into the Code tab filter
    Then the file browser should show a file "alpha/a1.txt"
    And the file browser should not show a file "beta/b1.txt"
    When I type "" into the Code tab filter
    Then the file browser should show a file "alpha/a1.txt"
    And the file browser should show a file "alpha/a2.txt"

  Scenario: Right-click on a file content line copies "path:line"
    When I run "rm -rf /tmp/kolu-browse-ctx && git init /tmp/kolu-browse-ctx && cd /tmp/kolu-browse-ctx"
    And I run "printf 'alpha\nbeta\ngamma\n' > letters.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    When I click the file "letters.txt" in the file browser
    Then the file content should contain "beta"
    When I right-click line 2 in the file content
    And I click the context menu item "Copy letters.txt:2"
    Then the clipboard should contain "letters.txt:2"

  Scenario: Switching diff files keeps the "Copy path:line" entry in sync
    When I run "rm -rf /tmp/kolu-diff-multifile && git init /tmp/kolu-diff-multifile && cd /tmp/kolu-diff-multifile"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'a-one\na-two\na-three\n' > file-a.txt"
    And I run "printf 'b-one\nb-two\nb-three\n' > file-b.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "file-a.txt"
    And the Code tab should list a changed file "file-b.txt"
    When I click the changed file "file-a.txt" in the Code tab
    Then the diff view should contain "a-one"
    When I right-click line 1 in the diff view
    And I click the context menu item "Copy file-a.txt:1"
    Then the clipboard should contain "file-a.txt:1"
    When I click the changed file "file-b.txt" in the Code tab
    Then the diff view should contain "b-one"
    When I right-click line 1 in the diff view
    Then the context menu items should be "Copy path | Copy file-b.txt:1 | Open file-b.txt:1"
    When I click the context menu item "Copy file-b.txt:1"
    Then the clipboard should contain "file-b.txt:1"
    And the clipboard should not contain "file-a.txt"

  Scenario: Right-click "Open path:N" in diff view jumps to browse at that line
    When I run "rm -rf /tmp/kolu-open-from-diff && git init /tmp/kolu-open-from-diff && cd /tmp/kolu-open-from-diff"
    And I run "git commit --allow-empty -m init"
    And I run "mkdir -p docs && printf 'first\nsecond\nthird\n' > docs/notes.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "docs/notes.txt"
    When I click the changed file "docs/notes.txt" in the Code tab
    Then the diff view should contain "second"
    When I right-click line 2 in the diff view
    And I click the context menu item "Open docs/notes.txt:2"
    Then the Code tab mode should be "browse"
    And the selected file should show content "second"
    And line 2 should be selected in the file content
    And the file browser should show a file "docs/notes.txt"
    And the file "docs/notes.txt" should be selected in the file browser

  Scenario: Binary file shows the "not displayable" placeholder
    When I run "rm -rf /tmp/kolu-binary-diff && git init /tmp/kolu-binary-diff && cd /tmp/kolu-binary-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'PNG\0fake\1\2' > image.png"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "image.png"
    When I click the changed file "image.png" in the Code tab
    Then the Code tab should show the binary placeholder

  Scenario: Text file does not show the binary placeholder
    When I run "rm -rf /tmp/kolu-text-diff && git init /tmp/kolu-text-diff && cd /tmp/kolu-text-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'hello\nworld\n' > note.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "note.txt"
    When I click the changed file "note.txt" in the Code tab
    Then the Code tab should render a diff view
    And the Code tab should not show the binary placeholder

  Scenario: Binary rename with content change shows the binary placeholder
    When I run "rm -rf /tmp/kolu-binary-rename && git init /tmp/kolu-binary-rename && cd /tmp/kolu-binary-rename"
    And I run "printf 'PNG\0fake\1\2\3\4\5\6\7\10\11\12\13\14\15\16\17' > old.png"
    And I run "git add old.png && git commit -m 'add binary'"
    And I run "git mv old.png new.png"
    And I run "printf 'PNG\0fake\1\2\3\4\5\6\7\10\11\12\13\14\15\16\17modified' > new.png"
    And I click the Code tab
    And I click the Code tab mode "local"
    Then the Code tab should list a changed file "new.png"
    When I click the changed file "new.png" in the Code tab
    Then the Code tab should show the binary placeholder

  Scenario: Binary placeholder classification follows refreshed file contents
    When I run "rm -rf /tmp/kolu-binary-flip && git init /tmp/kolu-binary-flip && cd /tmp/kolu-binary-flip"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'PNG\0fake\1\2' > note.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    And I click the changed file "note.txt" in the Code tab
    Then the Code tab should show the binary placeholder
    When I click the terminal canvas
    And I run "printf 'now text\n' > note.txt"
    And I click the Code tab mode "browse"
    And I click the Code tab mode "local"
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "now text"
    And the Code tab should not show the binary placeholder

  Scenario: Editing a file updates the diff view live
    When I run "rm -rf /tmp/kolu-live-diff && git init /tmp/kolu-live-diff && cd /tmp/kolu-live-diff"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'before\n' > note.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "before"
    When I click the terminal canvas
    And I run "printf 'after\n' > note.txt"
    Then the diff view should contain "after" while nudging "/tmp/kolu-live-diff/note.txt"

  Scenario: Editing a file updates browse-mode content live
    When I run "rm -rf /tmp/kolu-live-browse && git init /tmp/kolu-live-browse && cd /tmp/kolu-live-browse"
    And I run "printf 'first version\n' > letters.txt"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "letters.txt" in the file browser
    Then the file content should contain "first version"
    When I click the terminal canvas
    And I run "printf 'second version\n' > letters.txt"
    Then the file content should contain "second version" while nudging "/tmp/kolu-live-browse/letters.txt"

  Scenario: Refreshing browse view after an HTML edit reloads the iframe preview
    When I run "rm -rf /tmp/kolu-live-html && git init /tmp/kolu-live-html && cd /tmp/kolu-live-html"
    And I run "printf '<!doctype html><h1>preview version one</h1>\n' > page.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "page.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "preview version one"
    When I click the terminal canvas
    And I run "printf '<!doctype html><h1>preview version two</h1>\n' > page.html"
    And I click the Code tab mode "local"
    And I click the Code tab mode "browse"
    And I click the file "page.html" in the file browser
    Then the file preview iframe should contain "preview version two"

  Scenario: Clicking an in-page link moves the file tree selection
    When I run "rm -rf /tmp/kolu-html-nav && git init /tmp/kolu-html-nav && cd /tmp/kolu-html-nav"
    And I run "printf '<!doctype html><h1>first page</h1><a href=second.html>go to second</a>\n' > first.html"
    And I run "printf '<!doctype html><h1>second page</h1>\n' > second.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "first.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "first page"
    And the file "first.html" should be selected in the file browser
    When I click the link "go to second" in the file preview iframe
    Then the file preview iframe should contain "second page"
    And the file "second.html" should be selected in the file browser

  Scenario: Clicking an external link opens a new browser tab and leaves the preview in place
    When I run "rm -rf /tmp/kolu-html-ext && git init /tmp/kolu-html-ext && cd /tmp/kolu-html-ext"
    And I run "printf '<!doctype html><h1>home page</h1><a href=https://example.com/docs>external docs</a>\n' > home.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "home.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "home page"
    When I click the external link "external docs" in the file preview iframe
    Then a new browser tab should open to "https://example.com/docs"
    And the file preview iframe should contain "home page"
    And the file "home.html" should be selected in the file browser

  Scenario: Refreshing a file reached via an in-iframe link keeps the navigated path
    When I run "rm -rf /tmp/kolu-nav-edit && git init /tmp/kolu-nav-edit && cd /tmp/kolu-nav-edit"
    And I run "mkdir dist"
    And I run "printf '<!doctype html><h1>first page</h1><a href=second.html>go to second</a>\n' > dist/index.html"
    And I run "printf '<!doctype html><h1>second page ALPHA</h1>\n' > dist/second.html"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "dist" in the file browser
    And I click the file "dist/index.html" in the file browser
    Then the file preview iframe should be visible
    And the file preview iframe should contain "first page"
    When I click the link "go to second" in the file preview iframe
    Then the file preview iframe should contain "second page ALPHA"
    And the file "dist/second.html" should be selected in the file browser
    When I click the terminal canvas
    And I run "printf '<!doctype html><h1>second page BETA</h1>\n' > dist/second.html"
    And I click the Code tab mode "local"
    And I click the Code tab mode "browse"
    And the file "dist/second.html" should be selected in the file browser
    Then the file preview iframe should contain "second page BETA"

  Scenario: Committing the selected local diff clears the stale content pane
    When I run "rm -rf /tmp/kolu-clear-selected-local && git init /tmp/kolu-clear-selected-local && cd /tmp/kolu-clear-selected-local"
    And I run "git commit --allow-empty -m init"
    And I run "printf 'before\n' > note.txt"
    And I click the Code tab
    And I click the Code tab mode "local"
    And I click the changed file "note.txt" in the Code tab
    Then the diff view should contain "before"
    When I click the terminal canvas
    And I run "git add note.txt && git commit -m 'save note'"
    Then the Code tab should show the empty-changes message for repo "/tmp/kolu-clear-selected-local"
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
    And I run "printf 'watcher ready\n' > watcher-ready.txt"
    Then the file browser should show a file "watcher-ready.txt"
    When I click the terminal canvas
    And I run "rm obsolete.txt && test ! -e obsolete.txt && printf 'KOLU_DELETE_%s\n' SETTLED"
    And the screen state should contain "KOLU_DELETE_SETTLED"
    Then the file browser should not show a file "obsolete.txt"
    And the Code tab content should show the select hint "Select a file to view its content"

  Scenario: New file in an expanded folder appears in the browse tree live
    When I run "rm -rf /tmp/kolu-browse-newfile && git init /tmp/kolu-browse-newfile && cd /tmp/kolu-browse-newfile"
    And I run "mkdir -p lib && printf 'x\n' > lib/util.ts"
    And I run "git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the directory "lib" in the file browser
    Then the file browser should show a file "lib/util.ts"
    When I click the terminal canvas
    And I run "printf 'ready\n' > watcher-ready.txt"
    Then the file browser should show a file "watcher-ready.txt"
    When I click the terminal canvas
    And I run "printf 'y\n' > lib/added.ts"
    Then the file browser should show a file "lib/added.ts"

  Scenario: Comments tray is hidden when the queue is empty
    When I run "rm -rf /tmp/kolu-comments-empty && git init /tmp/kolu-comments-empty && cd /tmp/kolu-comments-empty"
    And I run "printf 'hello\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the comments tray should not be visible

  Scenario: Selecting text in a file shows the floating comment pill
    When I run "rm -rf /tmp/kolu-comments-pill && git init /tmp/kolu-comments-pill && cd /tmp/kolu-comments-pill"
    And I run "printf 'unique-pill-marker line one\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    Then the file content should contain "unique-pill-marker"
    When I select text "unique-pill-marker" in the file content
    Then the comment pill should be visible

  Scenario: Clicking the pill opens the composer; Save adds the comment to the tray
    When I run "rm -rf /tmp/kolu-comments-save && git init /tmp/kolu-comments-save && cd /tmp/kolu-comments-save"
    And I run "printf 'save-flow-marker here\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    Then the comments tray should not be visible
    When I select text "save-flow-marker" in the file content
    And I click the comment pill
    Then the comment composer should be visible
    When I type "agent should reword this" into the comment composer
    And I click the composer "Save" button
    Then the comment composer should not be visible
    And the comments tray should be visible
    And the comments tray should contain "agent should reword this"
    And the comments tray should have 1 comments

  Scenario: Commenting on the rendered Markdown preview
    When I run "rm -rf /tmp/kolu-comments-md-reopen && git init /tmp/kolu-comments-md-reopen && cd /tmp/kolu-comments-md-reopen"
    And I run "printf '# Doc Title\n\nmd-preview-marker in the body.\n' > README.md && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "md-preview-marker"
    When I select text "md-preview-marker" in the markdown preview
    And I click the comment pill
    Then the comment composer should be visible
    When I type "rendered-preview comment" into the comment composer
    And I click the composer "Save" button
    Then the comment composer should not be visible
    And the comments tray should be visible
    And the comments tray should contain "rendered-preview comment"
    And the comments tray should have 1 comments

  Scenario: Tray jump returns to the rendered Markdown surface
    When I run "rm -rf /tmp/kolu-comments-md-jump && git init /tmp/kolu-comments-md-jump && cd /tmp/kolu-comments-md-jump"
    And I run "printf '# Doc Title\n\nmd-jump-marker in the body.\n' > README.md && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    When I select text "md-jump-marker" in the markdown preview
    And I click the comment pill
    Then the comment composer should be visible
    When I type "jump-back comment" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should contain "jump-back comment"
    When I switch the file view to "source"
    Then the file view should be showing "source"
    When I click the tray comment "jump-back comment"
    Then the file view should be showing "rendered"
    And the markdown preview should be visible

  Scenario: Tray jump returns to the Source Markdown surface
    When I run "rm -rf /tmp/kolu-comments-md-src-jump && git init /tmp/kolu-comments-md-src-jump && cd /tmp/kolu-comments-md-src-jump"
    And I run "printf '# Heading Src\n\nbody text\n' > README.md && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    When I switch the file view to "source"
    Then the file view should be showing "source"
    And the file content should contain "# Heading Src"
    And the file content should be syntax highlighted
    When I select text "# Heading Src" in the file content
    And I click the comment pill
    Then the comment composer should be visible
    When I type "source-only comment" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should contain "source-only comment"
    When I switch the file view to "rendered"
    Then the file view should be showing "rendered"
    When I click the tray comment "source-only comment"
    Then the file view should be showing "source"
    And the comment highlight should be present

  Scenario: No-line comment tray jump records Code tab history
    When I run "rm -rf /tmp/kolu-comments-md-history && git init /tmp/kolu-comments-md-history && cd /tmp/kolu-comments-md-history"
    And I run "printf '# Doc Title\n\nmd-history-marker in the body.\n' > README.md && printf 'other-file-body\n' > other.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "md-history-marker"
    When I select text "md-history-marker" in the markdown preview
    And I click the comment pill
    Then the comment composer should be visible
    When I type "history-tray comment" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should contain "history-tray comment"
    When I click the file "other.txt" in the file browser
    Then the selected file should show content "other-file-body"
    When I click the tray comment "history-tray comment"
    Then the markdown preview should be visible
    And the Code tab "back" button should be enabled
    When I go back in the Code tab
    Then the selected file should show content "other-file-body"

  Scenario: Rendered Markdown comment highlight survives a DOM re-render
    When I run "rm -rf /tmp/kolu-comments-md-shiki && git init /tmp/kolu-comments-md-shiki && cd /tmp/kolu-comments-md-shiki"
    And I run "printf '# Doc\n\nmd-shiki-marker paragraph.\n\n```js\nconst x = 1;\n```\n' > README.md && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "README.md" in the file browser
    Then the markdown preview should be visible
    And the markdown preview should contain "md-shiki-marker"
    And the markdown preview should be syntax highlighted
    When I select text "md-shiki-marker" in the markdown preview
    And I click the comment pill
    Then the comment composer should be visible
    When I type "survives shiki" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should contain "survives shiki"
    And the comment highlight should be present
    When the markdown preview DOM is re-rendered
    Then the comment highlight should cover "md-shiki-marker" in the markdown preview

  Scenario: Cancel button dismisses the composer without saving
    When I run "rm -rf /tmp/kolu-comments-cancel && git init /tmp/kolu-comments-cancel && cd /tmp/kolu-comments-cancel"
    And I run "printf 'cancel-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "cancel-flow-marker" in the file content
    And I click the comment pill
    And I type "draft that should be discarded" into the comment composer
    And I click the composer "Cancel" button
    Then the comment composer should not be visible
    And the comments tray should not be visible

  Scenario: Escape key dismisses the composer
    When I run "rm -rf /tmp/kolu-comments-escape && git init /tmp/kolu-comments-escape && cd /tmp/kolu-comments-escape"
    And I run "printf 'escape-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "escape-flow-marker" in the file content
    And I click the comment pill
    Then the comment composer should be visible
    When I press Escape in the composer
    Then the comment composer should not be visible

  Scenario: Comments accumulate across multiple files in the same worktree
    When I run "rm -rf /tmp/kolu-comments-multi && git init /tmp/kolu-comments-multi && cd /tmp/kolu-comments-multi"
    And I run "printf 'multi-A-marker\n' > a.txt && printf 'multi-B-marker\n' > b.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "multi-A-marker" in the file content
    And I click the comment pill
    And I type "first note on A" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should have 1 comments
    When I click the file "b.txt" in the file browser
    And I select text "multi-B-marker" in the file content
    And I click the comment pill
    And I type "second note on B" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should have 2 comments
    And the comments tray should contain "first note on A"
    And the comments tray should contain "second note on B"

  Scenario: Per-comment × button removes just that one comment
    When I run "rm -rf /tmp/kolu-comments-remove && git init /tmp/kolu-comments-remove && cd /tmp/kolu-comments-remove"
    And I run "printf 'remove-X-marker\nremove-Y-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "remove-X-marker" in the file content
    And I click the comment pill
    And I type "note about alpha" into the comment composer
    And I click the composer "Save" button
    And I select text "remove-Y-marker" in the file content
    And I click the comment pill
    And I type "note about beta" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should have 2 comments
    When I remove the tray comment containing "note about alpha"
    Then the comments tray should have 1 comments
    And the comments tray should contain "note about beta"
    And the comments tray should not contain "note about alpha"

  Scenario: Discard all empties the queue and hides the tray
    When I run "rm -rf /tmp/kolu-comments-discard && git init /tmp/kolu-comments-discard && cd /tmp/kolu-comments-discard"
    And I run "printf 'discard-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "discard-flow-marker" in the file content
    And I click the comment pill
    And I type "temporary note" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should be visible
    When I click the comments tray "Discard all" button
    Then the comments tray should not be visible

  Scenario: Tray and queued comments persist across a page reload
    When I run "rm -rf /tmp/kolu-comments-persist && git init /tmp/kolu-comments-persist && cd /tmp/kolu-comments-persist"
    And I run "printf 'persist-flow-marker\n' > a.txt && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "a.txt" in the file browser
    And I select text "persist-flow-marker" in the file content
    And I click the comment pill
    And I type "should survive reload" into the comment composer
    And I click the composer "Save" button
    Then the comments tray should contain "should survive reload"
    When I reload the page
    And I click the Code tab
    Then the comments tray should contain "should survive reload"

  Scenario: Comments on a Markdown file work in the source view
    When I run "rm -rf /tmp/kolu-comments-md && git init /tmp/kolu-comments-md && cd /tmp/kolu-comments-md"
    And I run "printf '# Doc\n\nmd-source-comment-marker line\n' > notes.md && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "notes.md" in the file browser
    Then the markdown preview should be visible
    When I switch the file view to "source"
    Then the file view should be showing "source"
    And the file content should contain "md-source-comment-marker"
    And the file content should be syntax highlighted
    When I select text "md-source-comment-marker" in the file content
    Then the comment pill should be visible

  Scenario: Browse preview can scroll all the way to the last line
    When I run "rm -rf /tmp/kolu-tail-browse && git init /tmp/kolu-tail-browse && cd /tmp/kolu-tail-browse"
    And I run "for i in $(seq 1 199); do echo \"const line_$i = $i;\"; done > long.ts && echo 'const LAST_LINE_MARKER = 200;' >> long.ts && git add . && git commit -m init"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "long.ts" in the file browser
    And I scroll the file preview to the bottom until "LAST_LINE_MARKER" is rendered
    Then the file content should contain "LAST_LINE_MARKER"

  Scenario: Diff preview can scroll all the way to the last line
    When I run "rm -rf /tmp/kolu-tail-local && git init /tmp/kolu-tail-local && cd /tmp/kolu-tail-local"
    And I run "git commit --allow-empty -m init"
    And I run "for i in $(seq 1 199); do echo \"const line_$i = $i;\"; done > long.ts && echo 'const LAST_LINE_MARKER = 200;' >> long.ts"
    And I click the Code tab
    And I click the Code tab mode "local"
    And I click the changed file "long.ts" in the Code tab
    And I scroll the file preview to the bottom until "LAST_LINE_MARKER" is rendered
    Then the diff view should contain "LAST_LINE_MARKER"

  Scenario: Cmd/Ctrl+F opens terminal search from the terminal but defers outside it
    Given a Code tab in "browse" mode showing file "notes.txt" with content "find-me-here"
    When I click the file "notes.txt" in the file browser
    Then the file content should contain "find-me-here"
    When I focus the terminal
    And I press the find shortcut
    Then the terminal search bar should be visible
    When I press Escape
    Then the terminal search bar should not be visible
    When I focus the Code tab content
    And I press the find shortcut, watching for native handoff
    Then the terminal search bar should not be visible
    And the find shortcut should reach the browser
    And there should be no page errors

  Scenario: Each Code mode retains its tree and browse expansion
    When I run "rm -rf /tmp/kolu-tree-identity && git init /tmp/kolu-tree-identity && cd /tmp/kolu-tree-identity"
    And I run "mkdir folder && echo original > folder/file.txt && echo clean > browse-only.txt && git add . && git commit -m initial && echo changed >> folder/file.txt"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the file browser should show a file "browse-only.txt"
    When I click the directory "folder" in the file browser
    Then the directory "folder" should be expanded in the file browser
    When I mark the Code file tree
    And I click the Code tab mode "local"
    Then the file browser should show a file "folder/file.txt"
    And the file browser should not show a file "browse-only.txt"
    When I click the Code tab mode "browse"
    Then the file browser should show a file "browse-only.txt"
    And the Code file tree should be the kept-alive element
    And the directory "folder" should be expanded in the file browser
    And there should be no page errors

  Scenario: File saves update the retained Pierre source renderer
    When I run "rm -rf /tmp/kolu-file-identity && git init /tmp/kolu-file-identity && cd /tmp/kolu-file-identity"
    And I run "echo original-source-marker > file.txt && git add . && git commit -m initial"
    And I click the Code tab
    And I click the Code tab mode "browse"
    And I click the file "file.txt" in the file browser
    Then the file content should contain "original-source-marker"
    When I mark the Pierre source renderer
    And I run "echo saved-source-marker > file.txt"
    Then the file content should contain "saved-source-marker"
    And the Pierre source renderer should be the kept-alive element
    And there should be no page errors

  Scenario: A bare repository's folder is browsed from disk
    When I start recording error toasts
    And I run "rm -rf /tmp/kolu-bare-seed /tmp/kolu-bare && git init -q /tmp/kolu-bare-seed && printf 'readme-marker\n' > /tmp/kolu-bare-seed/README.md && git -C /tmp/kolu-bare-seed add . && git -C /tmp/kolu-bare-seed commit -qm init"
    And I run "mkdir -p /tmp/kolu-bare && git clone -q --bare /tmp/kolu-bare-seed /tmp/kolu-bare/.git && git -C /tmp/kolu-bare/.git worktree add -q /tmp/kolu-bare/.worktrees/feat"
    And I run "mkdir -p /tmp/kolu-bare/.claude && printf 'notes-marker\n' > /tmp/kolu-bare/notes.md && printf '<!doctype html><h1>bare-page-marker</h1>\n' > /tmp/kolu-bare/page.html && cd /tmp/kolu-bare"
    And I click the Code tab
    Then the Code tab should read the folder from disk
    And the file browser should show a directory ".git"
    And the file browser should show a directory ".worktrees"
    And the file browser should show a file "notes.md"
    When I click the directory ".worktrees" in the file browser
    Then the file browser should show a directory ".worktrees/feat"
    When I click the directory ".worktrees/feat" in the file browser
    Then the file browser should show a file ".worktrees/feat/README.md"
    When I click the file "notes.md" in the file browser
    Then the markdown preview should contain "notes-marker"
    When I click the file "page.html" in the file browser
    Then the file preview iframe should contain "bare-page-marker"
    And the Code tab should show no error
    And no "work tree" error toast should have been shown
    And no "Failed to encode" error toast should have been shown
    And there should be no page errors

  Scenario: Branch view names the missing base branch and how to fetch it
    When I start recording error toasts
    And I run "rm -rf /tmp/kolu-nobase && git init /tmp/kolu-nobase && cd /tmp/kolu-nobase"
    And I run "printf 'kept\n' > kept.md && git add . && git commit -m init"
    And I run "git remote add origin https://example.invalid/kolu-nobase.git"
    And I click the Code tab
    And I click the Code tab mode "browse"
    Then the file browser should show a file "kept.md"
    And the Code tab should show no error
    When I click the Code tab mode "branch"
    Then the Code tab error should say "No base branch found"
    And the Code tab error should say "git fetch origin"
    And no "No base branch found" error toast should have been shown
    And no "Failed to encode" error toast should have been shown
    And there should be no page errors
